import { useActiveOrgId } from "./accessRequests";
import { apiFetch } from "./api";
import { useAuth } from "./auth";
import { deploymentMode, type DeploymentMode, fetchSubscription, type Subscription } from "./billing";
import { useAsyncResource } from "./useAsyncResource";

/** One resolved limit of `GET /v1/organizations/{id}/limits`. */
export interface OrgLimit {
  key: string;
  kind: "count" | "behaviour" | "flag" | "knob" | "thresholds";
  /** A count's null means unlimited. */
  value?: boolean | number | string | number[] | null;
  source?: string | null;
  behaviour?: string | null;
  restricted_by?: string | null;
}

/** `GET /v1/organizations/{id}/seats` (also inside the limits' full view). */
export interface OrgSeats {
  organization_id: number;
  used: number;
  reserved: number;
  /** Null means unlimited. */
  max?: number | null;
  behaviour: "hard" | "soft" | "soft_then_hard";
  state: "unlimited" | "ok" | "warning" | "at_limit" | "over_limit";
}

export interface OrgLimits {
  organization_id: number;
  /** `full` for member managers and Platform Admins, `member` otherwise
   * (feature knobs only, no seats). */
  view: "full" | "member";
  tier: string;
  enforced: boolean;
  limits: OrgLimit[];
  seats?: OrgSeats | null;
}

export function fetchOrgLimits(orgId: number, token: string, signal?: AbortSignal) {
  return apiFetch<OrgLimits>(`/v1/organizations/${orgId}/limits`, {
    token,
    signal,
    cache: true,
  });
}

export interface Entitlement {
  loading: boolean;
  /** The org's plan (backend tier name; show it with `tierLabel`), null until known. */
  tier: string | null;
  limits: OrgLimit[];
  /** Seat usage; null for a caller who may not see it (ordinary members). */
  seats: OrgSeats | null;
  /** May the caller change the plan: `can_manage` on SaaS, a Platform Admin
   * (the licence holder) on a self-hosted install. */
  canManageBilling: boolean;
  deployment: DeploymentMode;
  /** Is the flag/knob `feature` (a limit key, e.g. `policy.sso_required`)
   * available on the org's plan? False while unknown. */
  isAvailable: (feature: string) => boolean;
}

/** The active org's plan, limits and seats, and whether the caller can change
 * the plan (plan-gating §12). Reads go through the shared read cache, so every
 * component on a page asking shares one request; an org switch changes the
 * session (and clears that cache), so it refetches for the new org. The server
 * enforces every limit; this only decides what to show. */
export function useEntitlement(): Entitlement {
  const { isAuthenticated, token, sessionKey, isPlatformAdmin } = useAuth();
  const orgId = useActiveOrgId();
  const res = useAsyncResource<{ limits: OrgLimits; sub: Subscription | null }>(
    async (signal) => {
      const [limits, sub] = await Promise.all([
        fetchOrgLimits(orgId as number, token, signal),
        // Only SaaS sells plans; a 403 just means "not a billing owner".
        deploymentMode === "saas"
          ? fetchSubscription(token, signal).catch(() => null)
          : Promise.resolve(null),
      ]);
      return { limits, sub };
    },
    { deps: [sessionKey, orgId], enabled: !!isAuthenticated && orgId !== null },
  );
  // Never show the previous org's numbers while the new org's load.
  const data = res.data?.limits.organization_id === orgId ? res.data : null;
  const limits = data?.limits.limits ?? [];
  return {
    loading: res.loading,
    tier: data?.limits.tier ?? null,
    limits,
    seats: data?.limits.seats ?? null,
    canManageBilling:
      deploymentMode === "saas"
        ? !!data?.sub && data.sub.can_manage !== false
        : !!isPlatformAdmin,
    deployment: deploymentMode,
    isAvailable: (feature) =>
      limits.some((l) => l.key === feature && (l.kind === "flag" || l.kind === "knob") && l.value === true),
  };
}
