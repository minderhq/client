import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoginPage } from "./LoginPage";

const login = vi.fn();
const register = vi.fn();
const navigate = vi.fn();
let isAuthenticated = false;
let locationState: { oidcError?: string; passwordReset?: boolean } | null = null;
let passwordResetEmail = false;

vi.mock("../lib/auth", () => ({
  useAuth: () => ({ isAuthenticated, login, register }),
}));
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ state: locationState }),
  Navigate: ({ to, replace }: { to: string; replace?: boolean }) => (
    <div data-testid="navigate" data-to={to} data-replace={String(replace)} />
  ),
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("../lib/passwordReset", () => ({
  useAuthCapabilities: () => ({ capabilities: null, passwordResetEmail, loading: false }),
}));
const redirectTo = vi.fn();
vi.mock("../lib/redirect", () => ({
  redirectTo: (url: string) => redirectTo(url),
}));
vi.mock("../lib/api", () => ({
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
    passwordResetEmail = false;
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

  describe("forgot password (#2138)", () => {
    it("links to /forgot-password when the gateway reports email reset", () => {
      passwordResetEmail = true;
      render(<LoginPage />);
      const link = screen.getByRole("link", { name: "Forgot password?" });
      expect(link.getAttribute("href")).toBe("/forgot-password");
    });

    it("hides the link when email reset is off or the capabilities failed", () => {
      // useAuthCapabilities reports false for both (see passwordReset.test.ts).
      passwordResetEmail = false;
      render(<LoginPage />);
      expect(screen.queryByRole("link", { name: "Forgot password?" })).toBeNull();
      // Sign-in itself is unaffected.
      expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
    });

    it("doesn't offer it on the create-account form", () => {
      passwordResetEmail = true;
      render(<LoginPage />);
      fireEvent.click(screen.getByRole("button", { name: "Create one" }));
      expect(screen.queryByRole("link", { name: "Forgot password?" })).toBeNull();
    });

    it("confirms a completed reset and focuses the confirmation", () => {
      locationState = { passwordReset: true };
      render(<LoginPage />);
      const notice = screen.getByRole("status");
      expect(notice.textContent).toMatch(/Your password was reset/);
      expect(document.activeElement).toBe(notice);
    });

    it("shows no reset confirmation on a plain visit", () => {
      render(<LoginPage />);
      expect(screen.queryByText(/Your password was reset/)).toBeNull();
    });
  });
});
