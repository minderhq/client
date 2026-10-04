import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import type { RegistrationModeState } from "../lib/registration";
import { InviteRedeemPage } from "./InviteRedeemPage";

const apiFetch = vi.fn();
const navigate = vi.fn();
let oidcLoginUrl = "";

vi.mock("../lib/api", async () => ({
  ...(await vi.importActual<typeof import("../lib/api")>("../lib/api")),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  friendlyErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
  get oidcLoginUrl() {
    return oidcLoginUrl;
  },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return { ...actual, useNavigate: () => navigate };
});

let registrationState: RegistrationModeState = { mode: "invite", loading: false };
vi.mock("../lib/registration", async () => ({
  ...(await vi.importActual<typeof import("../lib/registration")>(
    "../lib/registration",
  )),
  useRegistrationMode: () => registrationState,
}));

const loginWithToken = vi.fn();
const login = vi.fn();
const register = vi.fn();
function signedOut() {
  return { token: "", email: "", isAuthenticated: false, loginWithToken, login, register };
}
function signedIn(email = "invitee@example.com") {
  return { token: "tok", email, isAuthenticated: true, loginWithToken, login, register };
}
let mockAuth = signedOut();
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

/** Signed-out visitor on a pending invite; the form is ready to fill. */
async function openAsNewcomer(overrides: Partial<Record<string, unknown>> = {}) {
  apiFetch.mockResolvedValue(inviteInfo(overrides));
  renderAt("/invite/tok123");
  await screen.findByText(/invited you|You've been invited/);
}

function fillSignUp({ username = "ada", password = "hunter22" } = {}) {
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: username } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Create account & join" }));
}

describe("InviteRedeemPage", () => {
  afterEach(() => {
    cleanup();
    apiFetch.mockReset();
    navigate.mockReset();
    loginWithToken.mockReset();
    login.mockReset();
    register.mockReset();
    mockAuth = signedOut();
    registrationState = { mode: "invite", loading: false };
    oidcLoginUrl = "";
  });

  describe("signed out, no account", () => {
    it("shows the invite and a create-account form with the email locked", async () => {
      await openAsNewcomer();
      expect(screen.getByText("Engineering")).toBeTruthy();
      expect(screen.getByText(/\(team\)/)).toBeTruthy();
      const email = screen.getByLabelText("Email") as HTMLInputElement;
      expect(email.value).toBe("invitee@example.com");
      expect(email.readOnly).toBe(true);
      expect(email.getAttribute("aria-describedby")).toBe("invite-email-hint");
      expect(screen.getByRole("button", { name: "Sign in to accept" })).toBeTruthy();
    });

    it("names the inviter when the API provides it", async () => {
      await openAsNewcomer({ invited_by_name: "Grace" });
      expect(screen.getByText("Grace")).toBeTruthy();
      expect(screen.getByText(/invited you/)).toBeTruthy();
    });

    it("leaves the email editable for a shareable (unbound) invite", async () => {
      await openAsNewcomer({ email_bound: false });
      const email = screen.getByLabelText("Email") as HTMLInputElement;
      expect(email.readOnly).toBe(false);
      fireEvent.change(email, { target: { value: "other@example.com" } });
      register.mockResolvedValue(undefined);
      login.mockResolvedValue(undefined);
      fillSignUp();
      await vi.waitFor(() =>
        expect(register).toHaveBeenCalledWith(
          "ada",
          "other@example.com",
          "hunter22",
          "tok123",
        ),
      );
    });

    it("creates the account with the invite token, signs in, lands in the team -- never redeems", async () => {
      register.mockResolvedValue(undefined);
      login.mockResolvedValue(undefined);
      await openAsNewcomer();
      fillSignUp();

      await vi.waitFor(() =>
        expect(navigate).toHaveBeenCalledWith("/platform/teams", { replace: true }),
      );
      expect(register).toHaveBeenCalledWith(
        "ada",
        "invitee@example.com",
        "hunter22",
        "tok123",
      );
      expect(login).toHaveBeenCalledWith("ada", "hunter22");
      // The invite was consumed by /register: a redeem call would 409.
      expect(apiFetch).not.toHaveBeenCalledWith(
        expect.stringContaining("/redeem"),
        expect.anything(),
      );
      expect(loginWithToken).not.toHaveBeenCalled();
    });

    it("lands an org invite on the Organization page", async () => {
      register.mockResolvedValue(undefined);
      login.mockResolvedValue(undefined);
      await openAsNewcomer({
        team_id: null,
        team_name: null,
        team_role: null,
        organization_id: 7,
        org_name: "Acme",
        org_role: "member",
      });
      expect(screen.getByText(/\(organization\)/)).toBeTruthy();
      fillSignUp();
      await vi.waitFor(() =>
        expect(navigate).toHaveBeenCalledWith("/organization", { replace: true }),
      );
    });

    it("also offers sign-up from an invite on an open-mode instance", async () => {
      registrationState = { mode: "open", loading: false };
      await openAsNewcomer();
      expect(screen.getByRole("button", { name: "Create account & join" })).toBeTruthy();
    });

    it("offers no form on a closed instance, and points to SSO", async () => {
      registrationState = { mode: "sso_only", loading: false };
      oidcLoginUrl = "https://sso.example.com/authorize";
      await openAsNewcomer();
      expect(screen.queryByRole("button", { name: "Create account & join" })).toBeNull();
      expect(screen.getByText(/Sign in with SSO to accept/)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Sign in to accept" })).toBeTruthy();
    });

    it("points to an administrator on a closed instance without SSO", async () => {
      registrationState = { mode: "sso_only", loading: false };
      await openAsNewcomer();
      expect(screen.getByText(/Ask an administrator to create an account/)).toBeTruthy();
    });

    it("waits for the registration mode before showing the form", async () => {
      registrationState = { mode: null, loading: true };
      await openAsNewcomer();
      expect(screen.queryByRole("button", { name: "Create account & join" })).toBeNull();
    });
  });

  describe("sign-up errors", () => {
    it("explains an unusable invite and drops the form", async () => {
      register.mockRejectedValue(new ApiError("invite_invalid", 403));
      await openAsNewcomer();
      fillSignUp();
      await screen.findByText(/expired, been withdrawn, or already been used/);
      expect(screen.queryByRole("button", { name: "Create account & join" })).toBeNull();
      expect(login).not.toHaveBeenCalled();
    });

    it("explains an email mismatch and keeps the form", async () => {
      register.mockRejectedValue(new ApiError("invite_email_mismatch", 403));
      await openAsNewcomer({ email_bound: false });
      fillSignUp();
      await screen.findByText(/sent to a different email address/);
      expect(screen.getByRole("button", { name: "Create account & join" })).toBeTruthy();
      expect(login).not.toHaveBeenCalled();
    });

    it("sends an existing-accounts-only invite to sign-in, then back here", async () => {
      register.mockRejectedValue(new ApiError("invite_cannot_create_account", 403));
      await openAsNewcomer();
      fillSignUp();
      await screen.findByText(/only be used by someone who already has an account/);
      expect(screen.queryByRole("button", { name: "Create account & join" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Sign in to accept" }));
      expect(navigate).toHaveBeenCalledWith("/login", {
        state: { from: "/invite/tok123" },
      });
    });

    it("offers sign-in when the email already has an account", async () => {
      register.mockRejectedValue(new ApiError("Email already exists", 409));
      await openAsNewcomer();
      fillSignUp();
      await screen.findByText(/already exists\. Sign in instead/);
      // The header link and the inline one both lead to sign-in.
      const links = screen.getAllByRole("button", { name: "Sign in to accept" });
      fireEvent.click(links[links.length - 1]);
      expect(navigate).toHaveBeenCalledWith("/login", {
        state: { from: "/invite/tok123" },
      });
    });

    it("shows a taken username and lets the user retry", async () => {
      register.mockRejectedValueOnce(new ApiError("Username already exists", 409));
      await openAsNewcomer();
      fillSignUp();
      await screen.findByText("Username already exists");
      const button = screen.getByRole("button", { name: "Create account & join" });
      expect(button.hasAttribute("disabled")).toBe(false);
    });

    it("tells the user to sign in when the account was created but sign-in failed", async () => {
      register.mockResolvedValue(undefined);
      login.mockRejectedValue(new Error("Service unavailable"));
      await openAsNewcomer();
      fillSignUp();
      await screen.findByText(/Your account was created and the invite accepted/);
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
      expect(navigate).toHaveBeenCalledWith("/login", {
        state: { from: "/platform/teams" },
      });
      expect(apiFetch).not.toHaveBeenCalledWith(
        expect.stringContaining("/redeem"),
        expect.anything(),
      );
    });
  });

  describe("signed out, has an account", () => {
    it("goes to sign-in and asks to come back to the invite", async () => {
      await openAsNewcomer();
      fireEvent.click(screen.getByRole("button", { name: "Sign in to accept" }));
      expect(navigate).toHaveBeenCalledWith("/login", {
        state: { from: "/invite/tok123" },
      });
    });
  });

  describe("signed in", () => {
    it("shows a Join button and redeems", async () => {
      mockAuth = signedIn();
      apiFetch.mockImplementation((_path: string, opts?: { method?: string }) => {
        if (opts?.method === "POST")
          return Promise.resolve({ access_token: "fresh.jwt.token" });
        return Promise.resolve(inviteInfo());
      });
      renderAt("/invite/tok123");
      await screen.findByText(/You've been invited to join/);
      expect(screen.queryByLabelText("Username")).toBeNull();

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
        expect(loginWithToken).toHaveBeenCalledWith("fresh.jwt.token", expect.any(Number)),
      );
      await vi.waitFor(() =>
        expect(navigate).toHaveBeenCalledWith("/platform/teams", { replace: true }),
      );
      expect(register).not.toHaveBeenCalled();
    });

    it("explains a redeem refused for another account's email", async () => {
      mockAuth = signedIn("someone@example.com");
      apiFetch.mockImplementation((_path: string, opts?: { method?: string }) => {
        if (opts?.method === "POST")
          return Promise.reject(
            new ApiError("This invite was issued to a different email address", 403),
          );
        return Promise.resolve(inviteInfo());
      });
      renderAt("/invite/tok123");
      await screen.findByText(/You've been invited to join/);
      fireEvent.click(screen.getByRole("button", { name: "Join Engineering" }));
      await screen.findByText(/you're signed in as someone@example.com/);
      expect(navigate).not.toHaveBeenCalled();
    });

    it("explains an invite that expired before redeeming", async () => {
      mockAuth = signedIn();
      apiFetch.mockImplementation((_path: string, opts?: { method?: string }) => {
        if (opts?.method === "POST")
          return Promise.reject(new ApiError("Invite has expired", 410));
        return Promise.resolve(inviteInfo());
      });
      renderAt("/invite/tok123");
      await screen.findByText(/You've been invited to join/);
      fireEvent.click(screen.getByRole("button", { name: "Join Engineering" }));
      await screen.findByText(/This invite has expired\. Ask/);
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  describe("unusable invite links", () => {
    it.each([
      ["expired", /This invite has expired\..*send a new one/],
      ["revoked", /This invite was withdrawn/],
      ["accepted", /This invite has already been used/],
    ])("explains a %s invite with a next step", async (status, text) => {
      apiFetch.mockResolvedValue(inviteInfo({ status }));
      renderAt("/invite/tok123");
      await screen.findByText(text);
      expect(screen.queryByLabelText("Username")).toBeNull();
      expect(screen.queryByRole("button", { name: /Join/ })).toBeNull();
    });

    it("offers sign-in for an already-used invite when signed out", async () => {
      apiFetch.mockResolvedValue(inviteInfo({ status: "accepted" }));
      renderAt("/invite/tok123");
      await screen.findByText(/already been used/);
      expect(screen.getByRole("link", { name: "sign in" })).toBeTruthy();
    });

    it("explains a link that matches no invite", async () => {
      apiFetch.mockRejectedValue(new ApiError("Invite not found", 404));
      renderAt("/invite/nope");
      await screen.findByText(/This invite link isn't valid/);
      expect(screen.queryByLabelText("Username")).toBeNull();
    });
  });
});
