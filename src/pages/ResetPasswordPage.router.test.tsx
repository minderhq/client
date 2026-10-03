// Integration test with a real BrowserRouter (no router mocks), under
// StrictMode as in main.tsx: once the page has mounted, the reset token must
// be gone from window.location, from the history entry, from React Router's
// own in-memory location, and from everything the UI renders. It must
// survive only in component memory, for the explicit submit.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoginPage } from "./LoginPage";
import { ResetPasswordPage } from "./ResetPasswordPage";

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    isAuthenticated: false,
    logout: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
  }),
}));

const TOKEN = "mpr_c2VjcmV0LXJlc2V0LXRva2VuLWZvci10aGUtcm91dGVyLXRlc3Q";

/** Everything React Router exposes about the current location. */
let routerLocation: ReturnType<typeof useLocation> | null = null;
function LocationProbe() {
  routerLocation = useLocation();
  return null;
}

function renderApp() {
  return render(
    <StrictMode>
      <BrowserRouter>
        <LocationProbe />
        <Routes>
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </BrowserRouter>
    </StrictMode>,
  );
}

describe("ResetPasswordPage in a BrowserRouter", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    routerLocation = null;
    // The email link: path, query and the token in the fragment.
    window.history.replaceState(null, "", `/reset-password?lang=tr#token=${TOKEN}`);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("leaves the token nowhere but component memory after mount", async () => {
    const historyLength = window.history.length;
    renderApp();
    expect(screen.getByRole("heading", { name: "Choose a new password" })).toBeTruthy();

    // The browser: address bar and the current history entry.
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain(TOKEN);
    expect(window.location.pathname).toBe("/reset-password");
    expect(window.location.search).toBe("?lang=tr");
    expect(JSON.stringify(window.history.state ?? null)).not.toContain(TOKEN);
    expect(window.history.length).toBe(historyLength); // replaced, never pushed

    // The router: what useLocation() hands to any component. BrowserRouter
    // applies location changes in a transition, so wait for it to settle.
    await waitFor(() => expect(routerLocation?.hash).toBe(""));
    expect(routerLocation?.search).toBe("?lang=tr");
    expect(JSON.stringify(routerLocation)).not.toContain(TOKEN);

    // The UI: no markup, attribute or field value carries it.
    expect(document.documentElement.outerHTML).not.toContain(TOKEN);
    for (const input of document.querySelectorAll("input")) {
      expect(input.value).not.toContain(TOKEN);
    }

    // And nothing was sent on load.
    expect(fetch).not.toHaveBeenCalled();

    // It's still in memory: the explicit submit sends it, then signs in.
    // (LoginPage's capabilities call gets a 404: an older gateway.)
    vi.mocked(fetch).mockImplementation(async (url) =>
      String(url).endsWith("/v1/auth/password-reset/confirm")
        ? ({ ok: true, status: 204, json: async () => undefined, headers: new Headers() } as Response)
        : ({
            ok: false,
            status: 404,
            json: async () => ({ detail: "Not Found" }),
            headers: new Headers(),
          } as Response),
    );
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "a brand new password" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "a brand new password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set new password" }));
    await screen.findByRole("heading", { name: "Log in" });
    const confirms = vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).endsWith("/password-reset/confirm"));
    expect(confirms).toHaveLength(1);
    expect(JSON.parse(String(confirms[0][1]?.body)).token).toBe(TOKEN);
    expect(window.location.pathname).toBe("/login");
    expect(window.location.href).not.toContain(TOKEN);
  });

  it("shows the reset confirmation on sign-in once, not again on reload", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ detail: "Not Found" }),
      headers: new Headers(),
    } as Response);
    // Where ResetPasswordPage's navigate("/login", {state}) leaves history.
    window.history.replaceState(
      { usr: { passwordReset: true }, key: "k", idx: 0 },
      "",
      "/login",
    );
    renderApp();
    expect(screen.getByText(/Your password was reset/)).toBeTruthy();
    // LoginPage consumes the state from the history entry…
    await waitFor(() => expect(window.history.state?.usr ?? null).toBeNull());
    expect(window.location.pathname).toBe("/login");
    // …and keeps the notice for this visit.
    expect(screen.getByText(/Your password was reset/)).toBeTruthy();

    // A reload renders from the same history entry: no notice.
    cleanup();
    renderApp();
    expect(screen.getByRole("heading", { name: "Log in" })).toBeTruthy();
    expect(screen.queryByText(/Your password was reset/)).toBeNull();
  });
});
