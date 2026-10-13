import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EMAIL_VERIFIED_NOTICE, VerifyEmailPage } from "./VerifyEmailPage";

let isAuthenticated = false;
let token = "";
const loginWithToken = vi.fn();
const clearEmailVerificationRequired = vi.fn();
const logout = vi.fn();
vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    isAuthenticated,
    token,
    loginWithToken,
    clearEmailVerificationRequired,
    logout,
  }),
}));

function respond(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(headers),
  } as Response;
}

/** Routes the mocked fetch by path. */
function mockApi(routes: Record<string, () => Response>) {
  vi.mocked(fetch).mockImplementation(async (url) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    const route = routes[path];
    if (!route) throw new Error(`unmocked ${path}`);
    return route();
  });
}

function LoginStub() {
  const state = useLocation().state as { notice?: string } | null;
  return <p data-testid="login">{state?.notice}</p>;
}

function renderAt(url: string) {
  // The page reads the token from the real address bar, like in a browser.
  window.history.replaceState(null, "", url);
  return render(
    <MemoryRouter initialEntries={["/verify-email"]}>
      <Routes>
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/login" element={<LoginStub />} />
        <Route path="/" element={<p>home</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const confirmButton = () => screen.getByRole("button", { name: "Confirm my email" });

describe("VerifyEmailPage (#2447)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    isAuthenticated = false;
    token = "";
    loginWithToken.mockClear();
    clearEmailVerificationRequired.mockClear();
    logout.mockClear();
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("clears the token from the address bar and sends nothing on load", async () => {
    renderAt("/verify-email#token=mev_secret");
    await screen.findByRole("button", { name: "Confirm my email" });
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("mev_secret");
    expect(fetch).not.toHaveBeenCalled();
    expect(document.querySelector('meta[name="referrer"]')?.getAttribute("content")).toBe(
      "no-referrer",
    );
  });

  it("explains a URL without a token", async () => {
    renderAt("/verify-email");
    expect(await screen.findByText(/needs the link from your verification email/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm my email" })).toBeNull();
    expect(screen.getByRole("link", { name: "Log in" }).getAttribute("href")).toBe("/login");
  });

  it("confirms on press and sends a signed-out visitor to log in", async () => {
    mockApi({ "/v1/auth/verify-email": () => respond(200, { organization_id: 3 }) });
    renderAt("/verify-email#token=mev_ok");
    fireEvent.click(confirmButton());
    expect(await screen.findByText("Your email address is confirmed.")).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls[0][1]?.body).toBe(JSON.stringify({ token: "mev_ok" }));
    expect(screen.queryByRole("button", { name: "Confirm my email" })).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Log in to continue" }));
    expect((await screen.findByTestId("login")).textContent).toBe(EMAIL_VERIFIED_NOTICE);
    expect(loginWithToken).not.toHaveBeenCalled();
  });

  it("moves a signed-in session to a full token after confirming", async () => {
    isAuthenticated = true;
    token = "restricted.jwt";
    sessionStorage.setItem("minder_jwt", token);
    mockApi({
      "/v1/auth/verify-email": () => respond(200, { organization_id: 9 }),
      "/v1/auth/refresh": () => respond(200, { access_token: "full.jwt" }),
    });
    renderAt("/verify-email#token=mev_ok");
    fireEvent.click(confirmButton());
    const go = await screen.findByRole("link", { name: "Continue to Minder" });
    expect(clearEmailVerificationRequired).toHaveBeenCalled();
    expect(loginWithToken).toHaveBeenCalledWith("full.jwt", expect.any(Number));
    expect(go.getAttribute("href")).toBe("/");
  });

  it("offers a new link for an expired link when signed in", async () => {
    isAuthenticated = true;
    token = "restricted.jwt";
    mockApi({
      "/v1/auth/verify-email": () =>
        respond(400, { detail: "invalid_or_expired_token", reason: "expired" }),
      "/v1/auth/verify-email/resend": () => respond(202, { retry_after_seconds: 60 }),
    });
    renderAt("/verify-email#token=mev_old");
    fireEvent.click(confirmButton());
    expect(await screen.findByText(/This link has expired/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send a new link" }));
    expect(await screen.findByText(/We sent a new link/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Send a new link \(\d+s\)/ })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("explains a used link and points a signed-out visitor to log in", async () => {
    mockApi({
      "/v1/auth/verify-email": () => respond(400, { detail: "invalid_or_expired_token" }),
    });
    renderAt("/verify-email#token=mev_used");
    fireEvent.click(confirmButton());
    expect(await screen.findByText(/This link can't be used/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Log in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Send a new link/ })).toBeNull();
  });

  it("keeps the button after a rate limit, with the wait", async () => {
    mockApi({
      "/v1/auth/verify-email": () => respond(429, { detail: "rate" }, { "Retry-After": "30" }),
    });
    renderAt("/verify-email#token=mev_ok");
    fireEvent.click(confirmButton());
    expect(await screen.findByText(/Wait 30 seconds, then try again/)).toBeTruthy();
    expect(confirmButton()).toBeTruthy();
  });
});
