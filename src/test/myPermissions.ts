/**
 * Page-test helpers for the server's GET /v1/me/permissions (useCan).
 *
 * A page test that mocks lib/api's `apiFetch` and lib/auth's `useAuth` can
 * sign in a caller whose access comes from the server, not the role claims:
 * spread {@link SERVER_SESSION} into the mocked auth (with a custom `orgRole`
 * the role table doesn't know), then {@link serveMyPermissions} with the keys
 * the caller's role grants.
 */
import type { Mock } from "vitest";

import { resetServerPermissionsCache } from "../lib/useCan";

/** The auth fields useCan needs to ask the server (org 1). */
export const SERVER_SESSION = {
  isAuthenticated: true,
  sessionKey: "test-user:1",
  activeTenantId: "1",
  tenantId: "1",
};

/** A GET /v1/me/permissions body for org 1. */
export function myPermissions({
  orgKeys = [] as string[],
  orgWideTeamKeys = [] as string[],
  teams = [] as { id: number; keys: string[] }[],
  isPlatformAdmin = false,
  orgRole = "custom",
} = {}) {
  const held = (keys: string[]) =>
    keys.map((key) => ({ key, sources: [{ kind: "role", role_id: 9, role_name: orgRole }] }));
  return {
    user_id: 1,
    is_platform_admin: isPlatformAdmin,
    active_org: {
      id: 1,
      org_role: orgRole,
      suspended: false,
      permissions: held(orgKeys),
      org_wide_team_permissions: held(orgWideTeamKeys),
    },
    teams: teams.map((t) => ({ id: t.id, name: null, team_role: "custom", permissions: held(t.keys) })),
    permission_version: "1.1",
  };
}

/** Answer GET /v1/me/permissions with `body` on top of the mock's current
 * routing, and forget any earlier test's answer. */
export function serveMyPermissions(apiFetch: Mock, body: ReturnType<typeof myPermissions>): void {
  resetServerPermissionsCache();
  const route = apiFetch.getMockImplementation();
  apiFetch.mockImplementation((path: string, ...rest: unknown[]) =>
    path === "/v1/me/permissions" ? Promise.resolve(body) : route?.(path, ...rest),
  );
}
