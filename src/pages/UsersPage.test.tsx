import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UsersPage, type ManagedUser } from "./UsersPage";

const apiFetch = vi.fn();

vi.mock("../lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  friendlyErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
}));

let mockAuth = { token: "", role: "" };
vi.mock("../lib/auth", () => ({
  useAuth: () => mockAuth,
}));

function user(overrides: Partial<ManagedUser> = {}): ManagedUser {
  return {
    id: 1,
    username: "alice",
    email: "alice@example.com",
    role: "user",
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    is_oidc_linked: false,
    ...overrides,
  };
}

describe("UsersPage", () => {
  afterEach(() => {
    apiFetch.mockReset();
    mockAuth = { token: "", role: "" };
    cleanup();
  });

  it("shows an admin-required hint and never fetches when logged out", () => {
    render(<UsersPage />);
    expect(
      screen.getByText("Log in as an admin to view or manage users."),
    ).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("shows an admin-required hint (different copy) when logged in as a non-admin", () => {
    mockAuth = { token: "tok", role: "user" };
    render(<UsersPage />);
    expect(
      screen.getByText("Admin role required to view or manage users."),
    ).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("fetches and renders users for an admin", async () => {
    mockAuth = { token: "tok", role: "admin" };
    apiFetch.mockResolvedValue({
      users: [user()],
      total: 1,
      limit: 50,
      offset: 0,
    });
    render(<UsersPage />);

    await screen.findByText("alice");
    expect(screen.getByText("alice@example.com")).toBeTruthy();
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/auth/users",
      expect.objectContaining({ token: "tok", signal: expect.any(AbortSignal) }),
    );
  });

  it("shows an empty state when there are no users", async () => {
    mockAuth = { token: "tok", role: "admin" };
    apiFetch.mockResolvedValue({ users: [], total: 0, limit: 50, offset: 0 });
    render(<UsersPage />);

    await screen.findByText("No users found.");
  });

  it("shows an SSO-managed badge instead of a role dropdown for OIDC-linked accounts", async () => {
    mockAuth = { token: "tok", role: "admin" };
    apiFetch.mockResolvedValue({
      users: [user({ is_oidc_linked: true, role: "admin" })],
      total: 1,
      limit: 50,
      offset: 0,
    });
    render(<UsersPage />);

    await screen.findByText("admin (SSO-managed)");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("changes a local account's role via PATCH and reloads", async () => {
    mockAuth = { token: "tok", role: "admin" };
    apiFetch.mockImplementation(
      (_path: string, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return Promise.resolve(user({ role: "admin" }));
        return Promise.resolve({
          users: [user()],
          total: 1,
          limit: 50,
          offset: 0,
        });
      },
    );
    render(<UsersPage />);
    await screen.findByText("alice");

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "admin" } });

    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/auth/users/1/role", {
        method: "PATCH",
        token: "tok",
        body: { role: "admin" },
      }),
    );
  });

  it("shows a friendly error when a role change fails (e.g. the 409 for an SSO account)", async () => {
    mockAuth = { token: "tok", role: "admin" };
    apiFetch.mockImplementation(
      (_path: string, opts?: { method?: string }) => {
        if (opts?.method === "PATCH")
          return Promise.reject(new Error("managed by Authelia"));
        return Promise.resolve({
          users: [user()],
          total: 1,
          limit: 50,
          offset: 0,
        });
      },
    );
    render(<UsersPage />);
    await screen.findByText("alice");

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "admin" } });

    await screen.findByText("managed by Authelia");
  });
});
