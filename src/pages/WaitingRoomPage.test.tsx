import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "../lib/api";
import { AuthProvider } from "../lib/auth";
import { WorkspaceGate } from "./WaitingRoomPage";

const TOKEN_KEY = "minder_jwt";

function makeJwt(claims: Record<string, unknown>): string {
  const b64 = btoa(JSON.stringify(claims))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${b64}.sig`;
}
const exp = Math.floor(Date.now() / 1000) + 3600;
const tenantless = makeJwt({ sub: "7", username: "ada", exp });
const tenanted = makeJwt({
  sub: "7",
  username: "ada",
  exp,
  tenant_id: "5",
  active_tenant_id: "5",
});

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response;
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

describe("WorkspaceGate / waiting room (#116)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem(TOKEN_KEY, tenantless);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the app when the workspace is ready and the token has a tenant", async () => {
    sessionStorage.setItem(TOKEN_KEY, tenanted);
    mockApi({
      "GET /v1/profile/me": () => json({ user_id: 7, workspace_state: "ready" }),
    });
    renderGate();
    expect(await screen.findByText("app routes")).toBeTruthy();
  });

  it("offers Create my workspace when workspace_state is none and allowed", async () => {
    mockApi({
      "GET /v1/profile/me": () =>
        json({ user_id: 7, workspace_state: "none", can_create_workspace: true }),
    });
    renderGate();
    expect(
      await screen.findByRole("button", { name: "Create my workspace" }),
    ).toBeTruthy();
    expect(screen.queryByText("app routes")).toBeNull();
  });

  it("tells the user an admin must invite them when creating is not allowed", async () => {
    mockApi({
      "GET /v1/profile/me": () =>
        json({ user_id: 7, workspace_state: "none", can_create_workspace: false }),
    });
    renderGate();
    expect(await screen.findByText(/administrator has to invite you/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create my workspace" })).toBeNull();
  });

  it("shows the waiting room for pending_request and for an unknown state", async () => {
    mockApi({
      "GET /v1/profile/me": () =>
        json({
          user_id: 7,
          workspace_state: "pending_request",
          can_create_workspace: false,
        }),
    });
    renderGate();
    expect(await screen.findByText(/waiting for approval/)).toBeTruthy();
    cleanup();
    mockApi({
      "GET /v1/profile/me": () => json({ user_id: 7, workspace_state: "bogus" }),
    });
    renderGate();
    expect(await screen.findByText("No workspace yet")).toBeTruthy();
  });

  it("lets the app through when the profile predates workspace_state", async () => {
    mockApi({ "GET /v1/profile/me": () => json({ user_id: 7 }) });
    renderGate();
    expect(await screen.findByText("app routes")).toBeTruthy();
  });

  it("does not gate an invite link", () => {
    mockApi({
      "GET /v1/profile/me": () => json({ user_id: 7, workspace_state: "none" }),
    });
    renderGate("/invite/abc");
    expect(screen.getByText("app routes")).toBeTruthy();
  });

  it("shows the org switcher when ready but the token has no tenant", async () => {
    const switched = vi.fn(() => json({ access_token: tenanted }));
    mockApi({
      "GET /v1/profile/me": () => json({ user_id: 7, workspace_state: "ready" }),
      "GET /v1/organizations/mine": () =>
        json({
          organizations: [
            { id: 5, name: "Acme", slug: "acme", org_role: "member", is_home: false },
          ],
          active_organization_id: null,
        }),
      "POST /v1/organizations/switch": switched,
    });
    renderGate();
    fireEvent.click(await screen.findByRole("button", { name: /Acme/ }));
    await waitFor(() => expect(switched).toHaveBeenCalled());
    await waitFor(() => expect(sessionStorage.getItem(TOKEN_KEY)).toBe(tenanted));
    expect(await screen.findByText("app routes")).toBeTruthy();
  });

  it("stores the new token from Create my workspace and lets the app through", async () => {
    let state = "none";
    mockApi({
      "GET /v1/profile/me": () =>
        json({ user_id: 7, workspace_state: state, can_create_workspace: true }),
      "POST /v1/organizations/personal": () => {
        state = "ready";
        return json(
          { id: "5", name: "ada", slug: "ada", access_token: tenanted, expires_in: 3600 },
          201,
        );
      },
    });
    renderGate();
    fireEvent.click(await screen.findByRole("button", { name: "Create my workspace" }));
    await waitFor(() => expect(sessionStorage.getItem(TOKEN_KEY)).toBe(tenanted));
    expect(sessionStorage.getItem("minder_jwt_received_at")).toBeTruthy();
    expect(await screen.findByText("app routes")).toBeTruthy();
  });

  it("shows the waiting room on a 403 workspace_required without logging out", async () => {
    sessionStorage.setItem(TOKEN_KEY, tenanted);
    mockApi({
      "GET /v1/profile/me": () => json({ user_id: 7, workspace_state: "ready" }),
      "GET /v1/organizations/mine": () =>
        json({ organizations: [], active_organization_id: null }),
      "GET /v1/rag/knowledge-bases": () => json({ detail: "workspace_required" }, 403),
    });
    renderGate();
    await screen.findByText("app routes");
    await apiFetch("/v1/rag/knowledge-bases", { token: tenanted }).catch(() => {});
    expect(await screen.findByText("Choose an organization")).toBeTruthy();
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe(tenanted);
  });
});
