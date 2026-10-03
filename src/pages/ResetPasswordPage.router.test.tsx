// Integration tests with a real BrowserRouter (no router mocks), under
// StrictMode as in main.tsx. The MemoryRouter unit tests can't see what
// React Router itself holds: its location is read from window.location once
// and kept in memory, apart from the address bar.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useLayoutEffect, type ReactNode } from "react";
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

const TOKEN = "c2VjcmV0LXJlc2V0LXRva2VuLWZvci10aGUtcm91dGVyLXRlc3Q";

/** Everything React Router exposes about the current location. */
let routerLocation: ReturnType<typeof useLocation> | null = null;
function LocationProbe() {
  routerLocation = useLocation();
  return null;
}

/** The address bar as the browser first paints the page: a parent's layout
 * effect runs after its children's layout effects and before any passive
 * effect or paint. */
let hashAtFirstPaint: string | null = null;
function PaintProbe({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    hashAtFirstPaint ??= window.location.hash;
  }, []);
  return <>{children}</>;
}

function renderApp() {
  return render(
    <StrictMode>
      <BrowserRouter>
        <LocationProbe />
        <Routes>
          <Route
            path="/reset-password"
            element={
              <PaintProbe>
                <ResetPasswordPage />
              </PaintProbe>
            }
          />
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </BrowserRouter>
    </StrictMode>,
  );
}

function respond(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as Response;
}

describe("ResetPasswordPage in a BrowserRouter", () => {
  beforeEach(() => {
    // Every call but the confirm is a 404 (LoginPage's capabilities check:
    // an older gateway).
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) =>
        String(url).endsWith("/v1/auth/password-reset/confirm")
          ? respond(204)
          : respond(404, { detail: "Not Found" }),
      ),
    );
    routerLocation = null;
    hashAtFirstPaint = null;
    // The email link: path, query and the token in the fragment.
    window.history.replaceState(null, "", `/reset-password?lang=tr#token=${TOKEN}`);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("clears the token from the address bar before the first paint", () => {
    renderApp();
    expect(hashAtFirstPaint).toBe("");
  });

  it("leaves the token nowhere but component memory after mount", async () => {
    const historyLength = window.history.length;
    renderApp();
    expect(screen.getByRole("heading", { name: "Choose a new password" })).toBeTruthy();

    // The browser: address bar and the current history entry.
    expect(window.location.href).not.toContain(TOKEN);
    expect(window.location.pathname).toBe("/reset-password");
    expect(window.location.search).toBe("?lang=tr");
    expect(JSON.stringify(window.history.state ?? null)).not.toContain(TOKEN);
    expect(window.history.length).toBe(historyLength); // replaced, never pushed

    // The router: what useLocation() hands to any component.
    await waitFor(() => expect(routerLocation?.hash).toBe(""));
    expect(routerLocation?.pathname).toBe("/reset-password");
    expect(routerLocation?.search).toBe("?lang=tr");
    expect(JSON.stringify(routerLocation)).not.toContain(TOKEN);
    expect(window.history.length).toBe(historyLength);

    // Nothing was sent on load.
    expect(fetch).not.toHaveBeenCalled();

    // It's still in memory: the explicit submit sends it.
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

});
