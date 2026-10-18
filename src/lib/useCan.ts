import { useMemo } from "react";

import { useAuth } from "./auth";
import {
  accessFrom,
  allows,
  effectivePermissionsFromRoles,
  type Access,
  type EffectivePermissions,
  type PermissionKey,
  type PermissionScope,
  type Requirement,
} from "./permissions";
import { useBillingAccess } from "./useBillingAccess";

/**
 * The caller's effective permissions -- THE seam (#131). Today they are
 * derived from the session's role claims plus the billing probe
 * (`effectivePermissionsFromRoles`). Switching to the server's "my
 * permissions" response means replacing this function's body with a fetch
 * that yields the same {@link EffectivePermissions} shape; every gate below
 * and every caller stays as it is. Null while signed out.
 */
export function useEffectivePermissions(): EffectivePermissions | null {
  const { isAuthenticated, role, orgRole, isPlatformAdmin, activeTenantId, tenantId } = useAuth();
  const billingVisible = useBillingAccess();
  return useMemo(
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
}

/** Every gate at once, for filtering lists (sidebar, tabs, palette). */
export function useAccess(): Access {
  const effective = useEffectivePermissions();
  return useMemo(() => accessFrom(effective), [effective]);
}

/** May the caller do `key` in `scope` (default: the active org)? */
export function useCan(key: PermissionKey, scope?: PermissionScope): boolean {
  return useAccess().can(key, scope);
}

/** Does the caller meet `requirement` (a key, signed-in member, or Platform
 * Admin)? What route guards ask. */
export function useAllows(requirement: Requirement): boolean {
  return allows(useAccess(), requirement);
}
