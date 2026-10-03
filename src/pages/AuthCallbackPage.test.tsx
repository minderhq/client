import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PENDING_SSO_KEY, PENDING_SSO_TTL_MS, beginSsoLogin } from "../lib/ssoLogin";
import { AuthCallbackPage } from "./AuthCallbackPage";

const loginWithToken = vi.fn();
const navigate = vi.fn();

vi.mock("../lib/auth", () => ({
  useAuth: () => ({ loginWithToken }),
}));
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
}));

/** A previously-silent gap: a failed OIDC/SSO redirect (denied consent,
 * expired auth code, ...) carries `#error=...&error_description=...` instead
 * of `#token=...`, and used to fall straight through to navigate("/") with no
 * indication anything went wrong. Fixed to route to /login with the failure
 * message in router state instead. */
describe("AuthCallbackPage", () => {
  beforeEach(() => {
    loginWithToken.mockClear();
    navigate.mockClear();
  });
  afterEach(() => {
    cleanup();
    window.location.hash = "";
    sessionStorage.clear();
  });

  /** Start an SSO login the way LoginPage does; return its nonce. */
  function startLogin(now?: number): string {
    const url = new URL(beginSsoLogin("https://api.example.com/v1/auth/oidc/login", now));
    return url.searchParams.get("cnonce") ?? "";
  }

  const incomplete = {
    replace: true,
    state: { oidcError: "Sign-in did not complete — please try again." },
  };

  it("logs in and goes home when the token completes this browser's login", () => {
    const nonce = startLogin();
    window.location.hash = `#token=abc.def.ghi&cnonce=${nonce}`;
    render(<AuthCallbackPage />);
    expect(loginWithToken).toHaveBeenCalledWith("abc.def.ghi", expect.any(Number));
    // Send time = the navigation's start, never later than now (#56).
    expect(loginWithToken.mock.calls[0][1]).toBeLessThanOrEqual(Date.now());
    expect(navigate).toHaveBeenCalledWith("/", { replace: true });
  });

  it("URL-decodes the token before handing it to loginWithToken", () => {
    const nonce = startLogin();
    window.location.hash = `#token=abc%2Bdef&cnonce=${nonce}`;
    render(<AuthCallbackPage />);
    expect(loginWithToken).toHaveBeenCalledWith("abc+def", expect.any(Number));
  });

  it("consumes the pending login, so the same callback can't be replayed", () => {
    const nonce = startLogin();
    window.location.hash = `#token=abc.def.ghi&cnonce=${nonce}`;
    render(<AuthCallbackPage />);
    expect(sessionStorage.getItem(PENDING_SSO_KEY)).toBeNull();
    cleanup();
    loginWithToken.mockClear();
    navigate.mockClear();
    render(<AuthCallbackPage />);
    expect(loginWithToken).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/login", incomplete);
  });

  it("rejects a token when this browser has no pending login", () => {
    window.location.hash = "#token=abc.def.ghi&cnonce=QUJDREVGR0hJSktMTU5PUFFSU1RVVg";
    render(<AuthCallbackPage />);
    expect(loginWithToken).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/login", incomplete);
  });

  it("rejects a token that carries no nonce", () => {
    startLogin();
    window.location.hash = "#token=abc.def.ghi";
    render(<AuthCallbackPage />);
    expect(loginWithToken).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/login", incomplete);
    expect(sessionStorage.getItem(PENDING_SSO_KEY)).toBeNull();
  });

  it("rejects a token whose nonce doesn't match the pending login", () => {
    startLogin();
    window.location.hash = "#token=abc.def.ghi&cnonce=QUJDREVGR0hJSktMTU5PUFFSU1RVVg";
    render(<AuthCallbackPage />);
    expect(loginWithToken).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/login", incomplete);
    expect(sessionStorage.getItem(PENDING_SSO_KEY)).toBeNull();
  });

  it("rejects a token when the pending login has expired", () => {
    const nonce = startLogin(Date.now() - PENDING_SSO_TTL_MS - 1000);
    window.location.hash = `#token=abc.def.ghi&cnonce=${nonce}`;
    render(<AuthCallbackPage />);
    expect(loginWithToken).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/login", incomplete);
  });

  it("routes to /login with the failure reason when the redirect carries an OIDC error", () => {
    window.location.hash =
      "#error=access_denied&error_description=User+denied+access";
    render(<AuthCallbackPage />);
    expect(loginWithToken).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/login", {
      replace: true,
      state: { oidcError: "User denied access" },
    });
  });

  it("falls back to a generic message when the redirect has neither a token nor an error", () => {
    window.location.hash = "";
    render(<AuthCallbackPage />);
    expect(loginWithToken).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/login", incomplete);
  });

  it("clears a pending login when the redirect carries an OIDC error", () => {
    startLogin();
    window.location.hash = "#error=access_denied";
    render(<AuthCallbackPage />);
    expect(sessionStorage.getItem(PENDING_SSO_KEY)).toBeNull();
  });
});
