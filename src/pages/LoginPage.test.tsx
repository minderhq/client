import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import type { RegistrationModeState } from "../lib/registration";
import { LoginPage } from "./LoginPage";

const login = vi.fn();
const register = vi.fn();
const navigate = vi.fn();
let isAuthenticated = false;
let locationState: { oidcError?: string; from?: string } | null = null;
let registrationState: RegistrationModeState = { mode: "open", loading: false };

vi.mock("../lib/auth", () => ({
  useAuth: () => ({ isAuthenticated, login, register }),
}));
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ state: locationState }),
  Navigate: ({ to, replace }: { to: string; replace?: boolean }) => (
    <div data-testid="navigate" data-to={to} data-replace={String(replace)} />
  ),
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
vi.mock("../lib/registration", async () => ({
  ...(await vi.importActual<typeof import("../lib/registration")>(
    "../lib/registration",
  )),
  useRegistrationMode: () => registrationState,
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
    registrationState = { mode: "open", loading: false };
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

  describe("registration mode", () => {
    it("offers sign-up in open mode", () => {
      render(<LoginPage />);
      expect(screen.getByRole("button", { name: "Create one" })).toBeTruthy();
    });

    it("offers sign-up when the API doesn't report a mode (older API)", () => {
      registrationState = { mode: null, loading: false };
      render(<LoginPage />);
      expect(screen.getByRole("button", { name: "Create one" })).toBeTruthy();
    });

    it("offers nothing while the mode is still loading", () => {
      registrationState = { mode: null, loading: true };
      render(<LoginPage />);
      expect(screen.queryByRole("button", { name: "Create one" })).toBeNull();
      expect(screen.queryByText(/by invitation/)).toBeNull();
    });

    it("explains invitation-only sign-up instead of the form in invite mode", () => {
      registrationState = { mode: "invite", loading: false };
      render(<LoginPage />);
      expect(screen.queryByRole("button", { name: "Create one" })).toBeNull();
      expect(screen.getByText(/created by invitation/)).toBeTruthy();
      expect(screen.getByText(/ask\s+an administrator/)).toBeTruthy();
      // Signing in still works.
      expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
    });

    it("points to SSO instead of the form in closed mode", () => {
      registrationState = { mode: "closed", loading: false };
      render(<LoginPage />);
      expect(screen.queryByRole("button", { name: "Create one" })).toBeNull();
      expect(screen.getByText(/Sign-up is turned off/)).toBeTruthy();
      expect(screen.getByText(/Sign in with SSO below/)).toBeTruthy();
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
