import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InviteRedeemPage } from "./InviteRedeemPage";

const apiFetch = vi.fn();
const navigate = vi.fn();

vi.mock("../lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  friendlyErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return { ...actual, useNavigate: () => navigate };
});

const loginWithToken = vi.fn();
let mockAuth: {
  token: string;
  isAuthenticated: boolean;
  loginWithToken: typeof loginWithToken;
} = { token: "", isAuthenticated: false, loginWithToken };
vi.mock("../lib/auth", () => ({
  useAuth: () => mockAuth,
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/invite/:token" element={<InviteRedeemPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function inviteInfo(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    email: "invitee@example.com",
    team_id: 1,
    team_name: "Engineering",
    team_role: "member",
    status: "pending",
    ...overrides,
  };
}

describe("InviteRedeemPage", () => {
  afterEach(() => {
    apiFetch.mockReset();
    navigate.mockReset();
    loginWithToken.mockReset();
    mockAuth = { token: "", isAuthenticated: false, loginWithToken };
    cleanup();
  });

  it("shows a login prompt when not authenticated", async () => {
    apiFetch.mockResolvedValue(inviteInfo());
    renderAt("/invite/tok123");

    await screen.findByText(/You've been invited to join/);
    expect(screen.getByText("Engineering")).toBeTruthy();
    expect(screen.getByText("Go to login")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Join/ })).toBeNull();
  });

  it("shows a Join button and redeems when authenticated", async () => {
    mockAuth = { token: "tok", isAuthenticated: true, loginWithToken };
    apiFetch.mockImplementation((_path: string, opts?: { method?: string }) => {
      if (opts?.method === "POST")
        return Promise.resolve({ access_token: "fresh.jwt.token" });
      return Promise.resolve(inviteInfo());
    });
    renderAt("/invite/tok123");
    await screen.findByText(/You've been invited to join/);

    fireEvent.click(screen.getByRole("button", { name: "Join Engineering" }));

    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/invites/by-token/tok123/redeem", {
        method: "POST",
        token: "tok",
      }),
    );
    // #1071: the redeemed-with token predates this exact membership change,
    // so the fresh one from the redeem response must replace it.
    await vi.waitFor(() =>
      expect(loginWithToken).toHaveBeenCalledWith("fresh.jwt.token"),
    );
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/platform/teams", { replace: true }),
    );
  });

  it("shows a warning for a non-pending invite", async () => {
    apiFetch.mockResolvedValue(inviteInfo({ status: "expired" }));
    renderAt("/invite/tok123");

    await screen.findByText(/This invite is expired/);
  });

  it("shows a friendly error when redemption fails", async () => {
    mockAuth = { token: "tok", isAuthenticated: true, loginWithToken };
    apiFetch.mockImplementation((_path: string, opts?: { method?: string }) => {
      if (opts?.method === "POST")
        return Promise.reject(new Error("Invite has expired"));
      return Promise.resolve(inviteInfo());
    });
    renderAt("/invite/tok123");
    await screen.findByText(/You've been invited to join/);

    fireEvent.click(screen.getByRole("button", { name: "Join Engineering" }));

    await screen.findByText("Invite has expired");
    expect(navigate).not.toHaveBeenCalled();
  });
});
