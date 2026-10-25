import { useEffect, useMemo, useState } from "react";

import { apiFetch } from "./api";
import { useAuth } from "./auth";
import {
  accessFrom,
  allows,
  effectivePermissionsFromRoles,
  effectivePermissionsFromServer,
  type Access,
  type EffectivePermissions,
  type PermissionKey,
  type PermissionScope,
  type MyPermissionsResponse,
  type Requirement,
} from "./permissions";
import { useBillingAccess } from "./useBillingAccess";
import { useTokenRef } from "./useTokenRef";

/** The server's answer per session identity (`sessionKey`: user + active
 * org, changes on login, logout and org switch), so every component that
 * mounts a gate reads it synchronously instead of flickering through the
 * fallback. Failures are not stored: the next session (or reload) retries.
 * shortcut: no refetch on `permission_version`/`next_expires_at` within a
 * session; a role change shows after the next login or org switch. */
const serverCache = new Map<string, EffectivePermissions>();
/** One shared request per session identity while in flight. */
const inflight = new Map<string, Promise<EffectivePermissions | null>>();

function loadServerPermissions(sessionKey: string, token: string) {
  let pending = inflight.get(sessionKey);
  if (!pending) {
    // No AbortSignal: the request is shared between every mounted gate.
    pending = apiFetch<MyPermissionsResponse>("/v1/me/permissions", { token })
      .then(
        (r) => {
          // Anything but the documented shape (an older gateway, a proxy
          // page) is a failure: keep the role-claim fallback.
          if (typeof r?.is_platform_admin !== "boolean" || !Array.isArray(r.teams)) return null;
          const effective = effectivePermissionsFromServer(r);
          serverCache.set(sessionKey, effective);
          return effective;
        },
        () => null,
      )
      .finally(() => inflight.delete(sessionKey));
    inflight.set(sessionKey, pending);
  }
  return pending;
}

/** `GET /v1/me/permissions` for the current session; null while loading,
 * on error, or signed out. */
function useServerPermissions(): EffectivePermissions | null {
  const { sessionKey, isAuthenticated } = useAuth();
  const tokenRef = useTokenRef();
  const [loaded, setLoaded] = useState<{ key: string; value: EffectivePermissions } | null>(null);

  useEffect(() => {
    const token = tokenRef.current;
    if (!isAuthenticated || !token || !sessionKey) {
      // Signed out: forget every session's answer.
      serverCache.clear();
      return;
    }
    if (serverCache.has(sessionKey)) return;
    let current = true;
    loadServerPermissions(sessionKey, token).then((value) => {
      if (current && value) setLoaded({ key: sessionKey, value });
    });
    return () => {
      current = false;
    };
  }, [isAuthenticated, sessionKey, tokenRef]);

  if (!isAuthenticated || !sessionKey) return null;
  return serverCache.get(sessionKey) ?? (loaded?.key === sessionKey ? loaded.value : null);
}

/**
 * The caller's effective permissions -- THE seam (#131): the server's
 * `GET /v1/me/permissions` (custom roles, team grants and org-wide team
 * authority included). While that loads, or if it fails, they are derived
 * from the session's role claims plus the billing probe
 * (`effectivePermissionsFromRoles`), so gates never flicker away or break
 * offline. Null while signed out.
 */
export function useEffectivePermissions(): EffectivePermissions | null {
  const { isAuthenticated, role, orgRole, isPlatformAdmin, activeTenantId, tenantId } = useAuth();
  const billingVisible = useBillingAccess();
  const server = useServerPermissions();
  const fallback = useMemo(
    () =>
      effectivePermissionsFromRoles({
        authenticated: !!isAuthenticated,
        role: role ?? "",
        orgRole: orgRole ?? "",
        isPlatformAdmin: !!isPlatformAdmin,
        activeOrgId: activeTenantId || tenantId || "",
        billingVisible,
      }),
    [isAuthenticated, role, orgRole, isPlatformAdmin, activeTenantId, tenantId, billingVisible],
  );
  return isAuthenticated && server ? server : fallback;
}

/** Test hook: forget what the server said. */
export function resetServerPermissionsCache(): void {
  serverCache.clear();
  inflight.clear();
}

/** Every gate at once, for filtering lists (sidebar, tabs, palette). */
export function useAccess(): Access {
  const effective = useEffectivePermissions();
  return useMemo(() => accessFrom(effective), [effective]);
}

/** May the caller do `key` in `scope` (default: the active org)? A team key
 * without `teamId` asks "in any team of the active org" (own team grants, or
 * org-wide team authority): the "My team" question. */
export function useCan(key: PermissionKey, scope?: PermissionScope): boolean {
  return useAccess().can(key, scope);
}

/** Does the caller meet `requirement` (a key, signed-in member, or Platform
 * Admin)? What route guards ask. */
export function useAllows(requirement: Requirement): boolean {
  return allows(useAccess(), requirement);
}

/** May the caller list and manage the org's model providers? model-management's
 * `require_admin_or_org_admin` still accepts the legacy instance role
 * `role == "admin"` (outside the permission engine, and no longer a bypass on
 * the gateway's org gates), so it is ORed in here and nowhere else. */
export function useCanManageModelProviders(): boolean {
  const { role } = useAuth();
  return useCan("org.ai.manage") || role === "admin";
}
