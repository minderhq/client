import { apiFetch } from "./api";

/** The org's current billing state (GET /v1/billing/subscription). Always 200 —
 * an org with no billing event on file is a first-class state (`tier` = the free
 * baseline, `status` = null, `manageable` = false). */
export interface Subscription {
  tenant_id: string;
  /** The tier that ACTUALLY applies right now (active + unexpired, else baseline). */
  tier: string;
  /** True when `tier` is the free baseline (community) — i.e. no paid plan. */
  baseline: boolean;
  /** The raw entitlement's status, or null when there's no billing event. */
  status: string | null;
  valid_until: string | null;
  provider: string | null;
  /** True when there's a provider subscription the customer portal can manage. */
  manageable: boolean;
  /** Whether the CALLER may start a checkout / open the portal (org owner, billing
   * manager, or Platform Admin — minder#2036). The backend enforces it; this only
   * decides which actions to show. Absent on older backends → treated as allowed. */
  can_manage?: boolean;
}

export function fetchSubscription(token: string, signal?: AbortSignal) {
  return apiFetch<Subscription>("/v1/billing/subscription", {
    token,
    signal,
    cache: true,
  });
}

export interface CheckoutResponse {
  checkout_url: string;
  tier: string;
}

/** Start a hosted checkout for `tier` (POST /v1/billing/checkout). Returns the
 * provider URL the client should redirect to. 503 when billing isn't configured;
 * 422 for a tier with no configured variant. */
export function startCheckout(tier: string, token: string) {
  return apiFetch<CheckoutResponse>("/v1/billing/checkout", {
    method: "POST",
    body: { tier },
    token,
  });
}

export interface PortalResponse {
  portal_url: string;
}

/** Get the customer-portal URL for the org's current subscription
 * (POST /v1/billing/portal) — manage/cancel/update payment. 404 when there's no
 * provider subscription on file. */
export function openBillingPortal(token: string) {
  return apiFetch<PortalResponse>("/v1/billing/portal", {
    method: "POST",
    token,
  });
}

/** Paid tiers offered as upgrades, cheapest first. Kept in sync with the backend
 * tier vocabulary (shared/models/tiers); a tier with no configured provider
 * variant simply 422s at checkout, surfaced to the user. */
export const UPGRADE_TIERS = ["pro", "enterprise"] as const;

/** Default `base_tier` proposed for a new plugin submission (the free baseline
 * plan; same vocabulary as UPGRADE_TIERS). */
export const DEFAULT_SUBMISSION_TIER = "community";

/** A paid plan a feature or limit can require (`<PlanBadge>`, `<LimitNotice>`). */
export type PlanTier = (typeof UPGRADE_TIERS)[number];

const TIER_LABELS: Record<string, string> = {
  free: "Free",
  community: "Community",
  pro: "Pro",
  professional: "Pro",
  enterprise: "Enterprise",
};

/** A tier's display name (a product name: the same in every language). An
 * unknown tier is shown as sent. */
export function tierLabel(tier: string): string {
  return TIER_LABELS[tier.toLowerCase()] ?? tier;
}

/** The plan that lifts a limit of `tier`: Pro below Pro, Enterprise for Pro,
 * null for Enterprise (its overage is billed at renewal, nothing to sell). */
export function upgradeTierFor(tier: string | null | undefined): PlanTier | null {
  const t = (tier ?? "").toLowerCase();
  if (t === "enterprise") return null;
  return t === "pro" || t === "professional" ? "enterprise" : "pro";
}

/** Where this console runs (client#126 Q6.5), baked at build time like the
 * other VITE_* config: `saas` shows trial/upgrade actions to billing owners;
 * `self-hosted` (the default) shows "requires a licence" without buy buttons;
 * `air-gapped` also never links outside, only to a licence file. The API has
 * no way to tell yet. shortcut: the operator's "show upsell notes" installation
 * setting isn't readable from the API yet, so self-hosted is always upsell-off;
 * read it here once the gateway exposes it. */
export type DeploymentMode = "saas" | "self-hosted" | "air-gapped";

export function parseDeploymentMode(value: string | undefined): DeploymentMode {
  const v = (value ?? "").trim().toLowerCase();
  return v === "saas" || v === "air-gapped" ? v : "self-hosted";
}

export const deploymentMode: DeploymentMode = parseDeploymentMode(
  import.meta.env.VITE_DEPLOYMENT_MODE,
);
