import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import { LoginPage } from "./LoginPage";

const login = vi.fn();
const register = vi.fn();
const navigate = vi.fn();
let isAuthenticated = false;
let locationState:
  | { oidcError?: string; notice?: string; username?: string; from?: string }
  | null = null;
let passwordResetAvailable = false;
let capabilitiesLoading = false;
// What GET /v1/auth/capabilities reports as registration_mode (undefined = an
// older API without the field); `capabilitiesFailed` = the lookup failed.
let registrationMode: string | undefined = "open";
let capabilitiesFailed = false;

vi.mock("../lib/auth", () => ({
  useAuth: () => ({ isAuthenticated, login, register }),
}));
vi.mock("react-router-dom", () => ({
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useNavigate: () => navigate,
  useLocation: () => ({ pathname: "/login", search: "", state: locationState }),
  Navigate: ({ to, replace }: { to: string; replace?: boolean }) => (
    <div data-testid="navigate" data-to={to} data-replace={String(replace)} />
  ),
}));
const useAuthCapabilities = vi.fn(() => ({
  loading: capabilitiesLoading,
  capabilities:
    capabilitiesLoading || capabilitiesFailed
      ? null
      : {
          password_reset_email: passwordResetAvailable,
          email_verification: false,
          ...(registrationMode === undefined ? {} : { registration_mode: registrationMode }),
        },
}));
vi.mock("../lib/passwordReset", async () => ({
  ...(await vi.importActual<typeof import("../lib/passwordReset")>(
    "../lib/passwordReset",
  )),
  useAuthCapabilities: () => useAuthCapabilities(),
}));
const redirectTo = vi.fn();
vi.mock("../lib/redirect", () => ({
  redirectTo: (url: string) => redirectTo(url),
}));
vi.mock("../lib/api", async () => ({
  ...(await vi.importActual<typeof import("../lib/api")>("../lib/api")),
  friendlyErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
  oidcLoginUrl: "https://sso.example.com/authorize",
}));

function fillAndSubmit(
  submitButtonName: string,
  { username = "alice", email = "", password = "hunter2" } = {},
) {
  fireEvent.change(screen.getByLabelText("Username"), {
    target: { value: username },
  });
  if (email) {
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: email },
    });
  }
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole("button", { name: submitButtonName }));
}

describe("LoginPage", () => {
  beforeEach(() => {
    login.mockClear();
    register.mockClear();
    navigate.mockClear();
    isAuthenticated = false;
    locationState = null;
    passwordResetAvailable = false;
    capabilitiesLoading = false;
    registrationMode = "open";
    capabilitiesFailed = false;
  });
  afterEach(() => cleanup());

  it("redirects home when already authenticated", () => {
    isAuthenticated = true;
    render(<LoginPage />);
    const nav = screen.getByTestId("navigate");
    expect(nav.dataset.to).toBe("/");
    expect(nav.dataset.replace).toBe("true");
  });

  it("pre-populates the error banner from a failed OIDC redirect", () => {
    locationState = { oidcError: "User denied access" };
    render(<LoginPage />);
    expect(screen.getByText("User denied access")).toBeTruthy();
  });

  it("logs in without registering in login mode", async () => {
    login.mockResolvedValue(undefined);
    render(<LoginPage />);
    fillAndSubmit("Log in");
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/", { replace: true }),
    );
    expect(login).toHaveBeenCalledWith("alice", "hunter2");
    expect(register).not.toHaveBeenCalled();
  });

  it("registers then logs in when switched to register mode", async () => {
    register.mockResolvedValue(undefined);
    login.mockResolvedValue(undefined);
    render(<LoginPage />);
    fireEvent.click(screen.getByRole("button", { name: "Create one" }));
    fillAndSubmit("Create account & log in", { email: "alice@example.com" });
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/", { replace: true }),
    );
    expect(register).toHaveBeenCalledWith(
      "alice",
      "alice@example.com",
      "hunter2",
    );
    expect(login).toHaveBeenCalledWith("alice", "hunter2");
  });

  it("shows a friendly error and re-enables the form when login fails", async () => {
    login.mockRejectedValue(new Error("Invalid credentials"));
    render(<LoginPage />);
    fillAndSubmit("Log in");
    await screen.findByText("Invalid credentials");
    expect(
      screen.getByRole("button", { name: "Log in" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("does not attempt login when register() itself fails", async () => {
    register.mockRejectedValue(new Error("Username already taken"));
    render(<LoginPage />);
    fireEvent.click(screen.getByRole("button", { name: "Create one" }));
    fillAndSubmit("Create account & log in", { email: "alice@example.com" });
    await screen.findByText("Username already taken");
    expect(login).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("shows the SSO link when VITE_OIDC_LOGIN_URL is configured", () => {
    render(<LoginPage />);
    const link = screen.getByRole("link", { name: /Sign in with SSO/i });
    expect(link.getAttribute("href")).toBe("https://sso.example.com/authorize");
  });

  it("starts SSO with a fresh nonce that it records as the pending login", () => {
    redirectTo.mockClear();
    sessionStorage.clear();
    render(<LoginPage />);
    fireEvent.click(screen.getByRole("link", { name: /Sign in with SSO/i }));
    expect(redirectTo).toHaveBeenCalledTimes(1);
    const url = new URL(redirectTo.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe("https://sso.example.com/authorize");
    const nonce = url.searchParams.get("cnonce") ?? "";
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const pending = JSON.parse(sessionStorage.getItem("minder_sso_pending") ?? "{}");
    expect(pending.nonce).toBe(nonce);
    sessionStorage.clear();
  });

  it("offers 'Forgot password?' only when the server can send reset emails", () => {
    passwordResetAvailable = true;
    render(<LoginPage />);
    const link = screen.getByRole("link", { name: "Forgot password?" });
    expect(link.getAttribute("href")).toBe("/forgot-password");
    expect(screen.queryByText(/Ask your administrator/)).toBeNull();
    // Not offered while creating an account.
    fireEvent.click(screen.getByRole("button", { name: "Create one" }));
    expect(screen.queryByRole("link", { name: "Forgot password?" })).toBeNull();
  });

  it("without email reset, shows an ask-your-administrator hint instead of a link", () => {
    render(<LoginPage />);
    expect(screen.queryByRole("link", { name: "Forgot password?" })).toBeNull();
    expect(screen.getByText(/Ask your administrator to reset it/)).toBeTruthy();
  });

  it("shows neither while the capabilities are loading", () => {
    capabilitiesLoading = true;
    render(<LoginPage />);
    expect(screen.queryByRole("link", { name: "Forgot password?" })).toBeNull();
    expect(screen.queryByText(/Ask your administrator/)).toBeNull();
  });

  it("tells SSO users where their password is reset", () => {
    render(<LoginPage />);
    expect(screen.getByText(/SSO accounts reset their password at their identity provider/)).toBeTruthy();
  });

  it("after a reset shows the notice and focuses the username field", () => {
    locationState = { notice: "Your password has been reset." };
    render(<LoginPage />);
    expect(screen.getByRole("status").textContent).toBe("Your password has been reset.");
    expect(document.activeElement).toBe(screen.getByLabelText("Username"));
  });

  it("after a reset prefills a known username and focuses the password", () => {
    locationState = { notice: "Your password has been reset.", username: "alice" };
    render(<LoginPage />);
    expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("alice");
    expect(document.activeElement).toBe(screen.getByLabelText("Password"));
  });

  it("consumes the reset notice from the history entry, so a reload doesn't repeat it", () => {
    locationState = { notice: "Your password has been reset.", username: "alice" };
    render(<LoginPage />);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(
      { pathname: "/login", search: "" },
      { replace: true, state: null },
    );
    // Still shown for this visit.
    expect(screen.getByRole("status").textContent).toBe("Your password has been reset.");
  });

  it("consumes a failed-SSO error from the history entry, so a reload doesn't repeat it", () => {
    locationState = { oidcError: "Access denied" };
    render(<LoginPage />);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(
      { pathname: "/login", search: "" },
      { replace: true, state: null },
    );
    // Still shown for this visit.
    expect(screen.getByText("Access denied")).toBeTruthy();
  });

  it("leaves the history entry alone on a plain visit", () => {
    render(<LoginPage />);
    expect(navigate).not.toHaveBeenCalled();
  });

  describe("registration mode", () => {
    it("offers sign-up in open mode", () => {
      render(<LoginPage />);
      expect(screen.getByRole("button", { name: "Create one" })).toBeTruthy();
    });

    it("offers sign-up when the API doesn't report a mode (older API)", () => {
      registrationMode = undefined;
      render(<LoginPage />);
      expect(screen.getByRole("button", { name: "Create one" })).toBeTruthy();
    });

    it("offers nothing while the mode is still loading", () => {
      capabilitiesLoading = true;
      render(<LoginPage />);
      expect(screen.queryByRole("button", { name: "Create one" })).toBeNull();
      expect(screen.queryByText(/by invitation/)).toBeNull();
    });

    it("explains invitation-only sign-up instead of the form in invite mode", () => {
      registrationMode = "invite";
      render(<LoginPage />);
      expect(screen.queryByRole("button", { name: "Create one" })).toBeNull();
      expect(screen.getByText(/created by invitation/)).toBeTruthy();
      expect(screen.getByText(/ask\s+an administrator/)).toBeTruthy();
      // Signing in still works.
      expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
    });

    it("points to SSO instead of the form in closed mode", () => {
      registrationMode = "closed";
      render(<LoginPage />);
      expect(screen.queryByRole("button", { name: "Create one" })).toBeNull();
      expect(screen.getByText(/Sign-up is turned off/)).toBeTruthy();
      expect(screen.getByText(/Sign in with SSO below/)).toBeTruthy();
    });

    it("falls back to sign-up when the capabilities lookup fails", () => {
      capabilitiesFailed = true;
      render(<LoginPage />);
      expect(screen.getByRole("button", { name: "Create one" })).toBeTruthy();
      // ... and offers no reset link it can't vouch for.
      expect(screen.queryByRole("link", { name: "Forgot password?" })).toBeNull();
    });

    it("stops offering sign-up when the API says invites are required", async () => {
      register.mockRejectedValue(new ApiError("invite_required", 403));
      render(<LoginPage />);
      fireEvent.click(screen.getByRole("button", { name: "Create one" }));
      fillAndSubmit("Create account & log in", { email: "alice@example.com" });
      await screen.findByText(/created by invitation only/);
      expect(login).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "Create one" })).toBeNull();
      expect(screen.getByRole("heading", { name: "Log in" })).toBeTruthy();
    });

    it("suggests signing in when the email already has an account", async () => {
      register.mockRejectedValue(new ApiError("Email already exists", 409));
      render(<LoginPage />);
      fireEvent.click(screen.getByRole("button", { name: "Create one" }));
      fillAndSubmit("Create account & log in", { email: "alice@example.com" });
      await screen.findByText(/already exists\. Sign in instead/);
    });
  });

  describe("return path", () => {
    it("returns to state.from after logging in", async () => {
      locationState = { from: "/invite/tok123" };
      login.mockResolvedValue(undefined);
      render(<LoginPage />);
      fillAndSubmit("Log in");
      await vi.waitFor(() =>
        expect(navigate).toHaveBeenCalledWith("/invite/tok123", { replace: true }),
      );
    });

    it("sends an already-signed-in visitor to state.from", () => {
      isAuthenticated = true;
      locationState = { from: "/invite/tok123" };
      render(<LoginPage />);
      expect(screen.getByTestId("navigate").dataset.to).toBe("/invite/tok123");
    });

    it("ignores a return path that leaves the app", async () => {
      locationState = { from: "//evil.example.com/x" };
      login.mockResolvedValue(undefined);
      render(<LoginPage />);
      fillAndSubmit("Log in");
      await vi.waitFor(() =>
        expect(navigate).toHaveBeenCalledWith("/", { replace: true }),
      );
    });

    it("keeps the return path when it consumes a failed-SSO error", async () => {
      locationState = { oidcError: "Access denied", from: "/invite/tok123" };
      login.mockResolvedValue(undefined);
      render(<LoginPage />);
      expect(navigate).toHaveBeenCalledWith(
        { pathname: "/login", search: "" },
        { replace: true, state: { from: "/invite/tok123" } },
      );
      fillAndSubmit("Log in");
      await vi.waitFor(() =>
        expect(navigate).toHaveBeenCalledWith("/invite/tok123", { replace: true }),
      );
    });

    it("keeps the return path across the SSO round trip", () => {
      sessionStorage.clear();
      locationState = { from: "/invite/tok123" };
      render(<LoginPage />);
      fireEvent.click(screen.getByRole("link", { name: /Sign in with SSO/i }));
      expect(sessionStorage.getItem("minder_return_path")).toBe("/invite/tok123");
      sessionStorage.clear();
    });
  });
});
