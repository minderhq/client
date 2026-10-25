import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RequirePermission } from "../components/RequirePermission";
import {
  resetServerPermissionsCache,
  useAccess,
  useAllows,
  useCan,
  useCanManageModelProviders,
  useEffectivePermissions,
} from "./useCan";

let mockAuth: Record<string, unknown> = {};
vi.mock("./auth", () => ({ useAuth: () => mockAuth }));
let mockBilling = false;
vi.mock("./useBillingAccess", () => ({ useBillingAccess: () => mockBilling }));
const apiFetch = vi.fn();
vi.mock("./api", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

const MEMBER = {
  isAuthenticated: true,
  role: "user",
  orgRole: "member",
  isPlatformAdmin: false,
  activeTenantId: "1",
  tenantId: "1",
};

describe("useCan (#131)", () => {
  beforeEach(() => {
    mockAuth = { ...MEMBER };
    mockBilling = false;
  });
  afterEach(cleanup);

  it("reads the session from useAuth", () => {
    expect(renderHook(() => useAllows("member")).result.current).toBe(true);
    expect(renderHook(() => useCan("org.members.manage")).result.current).toBe(false);
    mockAuth = { ...MEMBER, orgRole: "admin" };
    expect(renderHook(() => useCan("org.members.manage")).result.current).toBe(true);
  });

  it("takes billing from the billing probe", () => {
    expect(renderHook(() => useCan("org.billing.view")).result.current).toBe(false);
    mockBilling = true;
    expect(renderHook(() => useCan("org.billing.view")).result.current).toBe(true);
  });

  it("scopes to the active org, falling back to the home org", () => {
    mockAuth = { ...MEMBER, orgRole: "owner", activeTenantId: "", tenantId: "7" };
    expect(renderHook(() => useCan("org.settings.manage", { orgId: "7" })).result.current).toBe(true);
    expect(renderHook(() => useCan("org.settings.manage", { orgId: "8" })).result.current).toBe(false);
  });

  it("allows nothing signed out", () => {
    mockAuth = { isAuthenticated: false, role: "", orgRole: "" };
    mockBilling = true;
    expect(renderHook(() => useEffectivePermissions()).result.current).toBeNull();
    const access = renderHook(() => useAccess()).result.current;
    expect(access.isMember).toBe(false);
    expect(access.can("org.billing.view")).toBe(false);
  });

  it("gates operator screens on the Platform Admin, not a key", () => {
    expect(renderHook(() => useAllows("platform-admin")).result.current).toBe(false);
    mockAuth = { ...MEMBER, isPlatformAdmin: true };
    expect(renderHook(() => useAllows("platform-admin")).result.current).toBe(true);
  });

  it("keeps the same gates between renders while the session is unchanged", () => {
    const { result, rerender } = renderHook(() => useAccess());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

describe("RequirePermission (#131)", () => {
  beforeEach(() => {
    mockAuth = { ...MEMBER };
    mockBilling = false;
  });
  afterEach(cleanup);

  function guard() {
    render(
      <MemoryRouter>
        <RequirePermission requires="org.members.manage">
          <h1>Members</h1>
        </RequirePermission>
      </MemoryRouter>,
    );
  }

  it("renders the page for a caller who holds the permission", () => {
    mockAuth = { ...MEMBER, orgRole: "owner" };
    guard();
    expect(screen.getByRole("heading", { name: "Members" })).toBeTruthy();
  });

  it("renders the forbidden page, naming who it is for, for one who doesn't", () => {
    guard();
    expect(screen.queryByRole("heading", { name: "Members" })).toBeNull();
    expect(screen.getByRole("heading", { name: "You don't have access to this page" })).toBeTruthy();
    expect(screen.getByText("This page is open to organization owners and admins.")).toBeTruthy();
    const request = screen.getByRole("button", { name: "Request access" }) as HTMLButtonElement;
    expect(request.disabled).toBe(true);
    expect(request.getAttribute("aria-describedby")).toBe("request-access-soon");
    expect(screen.getByRole("link", { name: "Back to home" }).getAttribute("href")).toBe("/");
  });

  it("asks a signed-out visitor to sign in", () => {
    mockAuth = { isAuthenticated: false, role: "", orgRole: "" };
    guard();
    expect(screen.getByRole("heading", { name: "Sign in to continue" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Log in" }).getAttribute("href")).toBe("/login");
    expect(screen.queryByRole("button", { name: "Request access" })).toBeNull();
  });
});

describe("useCan reads GET /v1/me/permissions", () => {
  // A signed-in session the server is asked about (token + sessionKey).
  const SESSION = { ...MEMBER, token: "tok", sessionKey: "u1:1" };
  const held = (...keys: string[]) =>
    keys.map((key) => ({ key, sources: [{ kind: "role", role_id: 7, role_name: "Support agent" }] }));
  function response(overrides: Record<string, unknown> = {}) {
    return {
      user_id: 1,
      is_platform_admin: false,
      active_org: {
        id: 1,
        org_role: "member",
        permissions: held("org.members.view", "org.chatbots.manage"),
        org_wide_team_permissions: [],
      },
      teams: [],
      permission_version: "1.1",
      ...overrides,
    };
  }
  /** Render `useCan` and wait for the server's answer to replace the fallback. */
  async function settled<T>(hook: () => T, done: (v: T) => boolean) {
    const r = renderHook(hook);
    await waitFor(() => expect(done(r.result.current)).toBe(true));
    return r;
  }

  beforeEach(() => {
    resetServerPermissionsCache();
    apiFetch.mockReset();
    mockAuth = { ...SESSION };
    mockBilling = false;
  });
  afterEach(cleanup);

  it("grants a custom role the permissions the server lists, not the role claim's", async () => {
    apiFetch.mockResolvedValue(response());
    const { result } = await settled(() => useAccess(), (a) => a.can("org.chatbots.manage"));
    expect(result.current.can("org.members.manage")).toBe(false);
    expect(apiFetch).toHaveBeenCalledWith("/v1/me/permissions", { token: "tok" });
  });

  it("answers team keys from the team's own grants", async () => {
    apiFetch.mockResolvedValue(
      response({
        teams: [
          { id: 10, name: "Eng", team_role: "team_admin", permissions: held("team.members.manage") },
          { id: 11, name: "Ops", team_role: "member", permissions: held("team.members.view") },
        ],
      }),
    );
    const { result } = await settled(() => useAccess(), (a) => a.can("team.members.manage"));
    expect(result.current.can("team.members.manage", { teamId: "10" })).toBe(true);
    expect(result.current.can("team.members.manage", { teamId: "11" })).toBe(false);
  });

  it("answers team keys on every team from org_wide_team_permissions", async () => {
    apiFetch.mockResolvedValue(
      response({
        active_org: {
          id: 1,
          org_role: "admin",
          permissions: held("org.teams.manage"),
          org_wide_team_permissions: held("team.members.manage"),
        },
      }),
    );
    const { result } = await settled(() => useAccess(), (a) => a.can("org.teams.manage"));
    // "Any team where I hold X", and a team the caller isn't a member of.
    expect(result.current.can("team.members.manage")).toBe(true);
    expect(result.current.can("team.members.manage", { teamId: "99" })).toBe(true);
    expect(result.current.can("team.settings.manage", { teamId: "99" })).toBe(false);
  });

  it("takes the Platform Admin from the server", async () => {
    apiFetch.mockResolvedValue(response({ is_platform_admin: true, active_org: null }));
    const { result } = await settled(() => useAccess(), (a) => a.isPlatformAdmin);
    expect(result.current.can("org.members.manage")).toBe(true);
  });

  it("uses the role-claim fallback while loading and on error", async () => {
    mockAuth = { ...SESSION, orgRole: "admin" };
    let fail: (e: Error) => void = () => {};
    apiFetch.mockReturnValue(new Promise((_, reject) => (fail = reject)));
    const { result } = renderHook(() => useCan("org.members.manage"));
    expect(result.current).toBe(true);
    fail(new Error("offline"));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(result.current).toBe(true);
  });

  it("ignores a response that isn't the documented shape", async () => {
    mockAuth = { ...SESSION, orgRole: "admin" };
    apiFetch.mockResolvedValue({ items: [] });
    const { result } = renderHook(() => useCan("org.members.manage"));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    await Promise.resolve();
    expect(result.current).toBe(true);
  });

  it("asks once per session and again after an org switch", async () => {
    apiFetch.mockResolvedValue(response());
    const { result, rerender } = await settled(() => useCan("org.chatbots.manage"), (v) => v);
    renderHook(() => useCan("org.chatbots.manage"));
    expect(apiFetch).toHaveBeenCalledTimes(1);

    apiFetch.mockResolvedValue(response({ active_org: { id: 2, org_role: "member", permissions: [] } }));
    mockAuth = { ...SESSION, activeTenantId: "2", sessionKey: "u1:2" };
    rerender();
    await waitFor(() => expect(result.current).toBe(false));
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("forgets the server's answer on logout", async () => {
    apiFetch.mockResolvedValue(response());
    const { result, rerender } = await settled(() => useEffectivePermissions(), (v) => !!v?.active_org?.permissions.length);
    mockAuth = { isAuthenticated: false, role: "", orgRole: "", token: "", sessionKey: "" };
    rerender();
    expect(result.current).toBeNull();

    // Signing back in to the same session asks the server again.
    mockAuth = { ...SESSION };
    rerender();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
  });

  it("mirrors the providers gate: instance admin or org owner/admin only", async () => {
    mockAuth = { ...MEMBER, role: "admin" };
    expect(renderHook(() => useCanManageModelProviders()).result.current).toBe(true);
    mockAuth = { ...MEMBER, orgRole: "owner" };
    expect(renderHook(() => useCanManageModelProviders()).result.current).toBe(true);
    mockAuth = { ...MEMBER };
    expect(renderHook(() => useCanManageModelProviders()).result.current).toBe(false);
    // A Platform Admin who isn't owner/admin, and a custom role holding
    // org.ai.manage, don't pass the server's gate today.
    mockAuth = { ...MEMBER, isPlatformAdmin: true };
    expect(renderHook(() => useCanManageModelProviders()).result.current).toBe(false);
    mockAuth = { ...SESSION };
    apiFetch.mockResolvedValue(response({ active_org: { id: 1, org_role: "member", permissions: held("org.ai.manage") } }));
    await settled(() => useCan("org.ai.manage"), (v) => v);
    expect(renderHook(() => useCanManageModelProviders()).result.current).toBe(false);
  });

  it("doesn't ask again in a session whose request failed", async () => {
    apiFetch.mockRejectedValue(new Error("404"));
    renderHook(() => useCan("org.members.view"));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    renderHook(() => useCan("org.members.view"));
    await new Promise((r) => setTimeout(r, 0));
    expect(apiFetch).toHaveBeenCalledTimes(1);
    // A new session (org switch) retries.
    mockAuth = { ...SESSION, sessionKey: "u1:2", activeTenantId: "2" };
    renderHook(() => useCan("org.members.view"));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
  });
});
