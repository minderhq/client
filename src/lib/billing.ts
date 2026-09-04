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
}

export function fetchSubscription(token: string, signal?: AbortSignal) {
  return apiFetch<Subscription>("/v1/billing/subscription", { token, signal });
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
