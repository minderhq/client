import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "../lib/api";
import { AuthProvider } from "../lib/auth";
import { WorkspaceGate } from "./WaitingRoomPage";

const TOKEN_KEY = "minder_jwt";
const FLAG_KEY = "minder_email_verification_required";

function makeJwt(claims: Record<string, unknown>): string {
  const b64 = btoa(JSON.stringify(claims))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${b64}.sig`;
}
const exp = Math.floor(Date.now() / 1000) + 3600;
const restricted = makeJwt({ sub: "7", username: "ada", email: "ada@example.com", exp });
const full = makeJwt({
  sub: "7",
  username: "ada",
  email: "ada@example.com",
  exp,
  tenant_id: "5",
  active_tenant_id: "5",
});

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    headers: new Headers(headers),
  } as Response;
}

/** Routes the mocked fetch by "METHOD path". */
function mockApi(routes: Record<string, () => Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, "");
      const key = `${init?.method ?? "GET"} ${path}`;
      const route = routes[key];
      if (!route) throw new Error(`unmocked ${key}`);
      return route();
    }),
  );
}

const pending = { user_id: 7, workspace_state: "none", email_verification_required: true };
const verified = { user_id: 7, workspace_state: "ready", email_verification_required: false };

function renderGate(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <WorkspaceGate>
          <div>app routes</div>
        </WorkspaceGate>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("WorkspaceGate / check your email (#2447)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem(TOKEN_KEY, restricted);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows Check your email, not the waiting room, while the profile says so", async () => {
    mockApi({
      "GET /v1/profile/me": () => json(pending),
      "GET /v1/auth/capabilities": () =>
        json({ email_verification: true, email_verify_link_hours: 24 }),
    });
    renderGate();
    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeTruthy();
    expect(screen.getByText("ada@example.com")).toBeTruthy();
    expect(await screen.findByText(/it works for 24 hours/)).toBeTruthy();
    expect(screen.queryByText("app routes")).toBeNull();
    expect(screen.queryByText("No workspace yet")).toBeNull();
  });

  it("shows it right after a login that said so, before the profile answers", async () => {
    sessionStorage.setItem(FLAG_KEY, "1");
    mockApi({
      "GET /v1/profile/me": () => json({ detail: "boom" }, 500),
      "GET /v1/auth/capabilities": () => json({}),
    });
    renderGate();
    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeTruthy();
  });

  it("lets the app through once the profile says the address is confirmed", async () => {
    sessionStorage.setItem(TOKEN_KEY, full);
    sessionStorage.setItem(FLAG_KEY, "1");
    mockApi({ "GET /v1/profile/me": () => json(verified) });
    renderGate();
    expect(await screen.findByText("app routes")).toBeTruthy();
  });

  it("switches to it when a request is refused with email_verification_required", async () => {
    sessionStorage.setItem(TOKEN_KEY, full);
    mockApi({
      "GET /v1/profile/me": () => json({ user_id: 7, workspace_state: "ready" }),
      "GET /v1/plugins": () => json({ detail: "email_verification_required" }, 403),
      "GET /v1/auth/capabilities": () => json({}),
    });
    renderGate();
    expect(await screen.findByText("app routes")).toBeTruthy();
    await act(async () => {
      await apiFetch("/v1/plugins", { token: full }).catch(() => undefined);
    });
    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeTruthy();
    // Not a logout.
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe(full);
  });

  it("does not gate the verification link itself", () => {
    mockApi({ "GET /v1/profile/me": () => json(pending) });
    renderGate("/verify-email");
    expect(screen.getByText("app routes")).toBeTruthy();
  });

  it("resends and counts down the server's cooldown", async () => {
    let sends = 0;
    mockApi({
      "GET /v1/profile/me": () => json(pending),
      "GET /v1/auth/capabilities": () => json({}),
      "POST /v1/auth/verify-email/resend": () => {
        sends += 1;
        return json({ detail: "verification_email_sent", retry_after_seconds: 60 }, 202);
      },
    });
    renderGate();
    fireEvent.click(await screen.findByRole("button", { name: "Send a new link" }));
    expect(await screen.findByText(/We sent a new link/)).toBeTruthy();
    const counting = screen.getByRole("button", { name: /Send a new link \(\d+s\)/ });
    expect(counting).toHaveProperty("disabled", true);
    expect(sends).toBe(1);
  });

  it("explains the daily limit on a long Retry-After", async () => {
    mockApi({
      "GET /v1/profile/me": () => json(pending),
      "GET /v1/auth/capabilities": () => json({}),
      "POST /v1/auth/verify-email/resend": () =>
        json({ detail: "verification_email_rate_limited" }, 429, { "Retry-After": "86400" }),
    });
    renderGate();
    fireEvent.click(await screen.findByRole("button", { name: "Send a new link" }));
    expect(await screen.findByText(/most links allowed today/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send a new link" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("tells an undeliverable address apart", async () => {
    mockApi({
      "GET /v1/profile/me": () => json(pending),
      "GET /v1/auth/capabilities": () => json({}),
      "POST /v1/auth/verify-email/resend": () => json({ detail: "email_undeliverable" }, 409),
    });
    renderGate();
    fireEvent.click(await screen.findByRole("button", { name: "Send a new link" }));
    expect(await screen.findByText(/can't deliver email to this address/)).toBeTruthy();
  });

  it("I've confirmed: stays put while still pending, lets in once confirmed", async () => {
    let confirmed = false;
    mockApi({
      "GET /v1/profile/me": () => json(confirmed ? verified : pending),
      "GET /v1/auth/capabilities": () => json({}),
      "POST /v1/auth/refresh": () => json({ access_token: full }),
    });
    renderGate();
    const button = await screen.findByRole("button", { name: "I've confirmed my email" });
    fireEvent.click(button);
    expect(await screen.findByText(/isn't confirmed yet/)).toBeTruthy();

    confirmed = true;
    fireEvent.click(screen.getByRole("button", { name: "I've confirmed my email" }));
    expect(await screen.findByText("app routes")).toBeTruthy();
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe(full);
  });

  it("Sign out leaves the screen", async () => {
    mockApi({
      "GET /v1/profile/me": () => json(pending),
      "GET /v1/auth/capabilities": () => json({}),
    });
    renderGate();
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByText("app routes")).toBeTruthy();
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});
