/**
 * The request system (client#126 Q2, Q3, Q4): a member asks for what they
 * can't do themselves (install a plugin, get a model, join a team), the
 * people who can decide get it in their inbox, and the requester follows the
 * answer. The gateway's `/v1/access-requests` routes do the routing, the
 * "first decision closes it for everyone" rule, expiry and the 30-day
 * anti-spam; this module only calls them.
 */
import { useEffect } from "react";

import { useAuth } from "./auth";
import { ApiError, apiFetch } from "./api";
import type { PermissionKey, Requirement } from "./permissions";
import { useAccess } from "./useCan";
import { useAsyncResource } from "./useAsyncResource";

/** The kinds a member files from the console. The API also knows `join`
 * (an account without a workspace) and `invite`, which come from elsewhere,
 * and `plan_request`, which the plan pages will send (step 11). */
export type AccessRequestKind = "team_join" | "plugin_install" | "model_request";

/** Every status the API sends today. Plain strings on the wire: render an
 * unknown one as-is rather than failing. */
export const REQUEST_STATUSES = ["pending", "approved", "denied", "expired", "withdrawn"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** A request as its requester sees it (`GET /v1/access-requests`). */
export interface MyAccessRequest {
  id: number;
  kind: string;
  status: string;
  organization_id?: number | null;
  organization_name?: string | null;
  team_id?: number | null;
  subject?: string | null;
  note?: string | null;
  /** The decider's reason, for a denied request. */
  decision_reason?: string | null;
  created_at?: string | null;
  expires_at?: string | null;
  decided_at?: string | null;
  /** Until when the same request is refused (30 days). */
  cooldown_until?: string | null;
}

/** A request as a decider sees it (`GET /v1/access-requests/inbox`). */
export interface InboxRequest extends MyAccessRequest {
  team_name?: string | null;
  requester: { id: number; username?: string | null; email?: string | null };
  /** Who decided it: the first decision closes it for every recipient. */
  decided_by_username?: string | null;
}

interface ListResponse<T> {
  requests?: T[];
  total: number;
}

export interface NewAccessRequest {
  kind: AccessRequestKind;
  organization_id: number;
  /** team_join: the team. */
  team_id?: number;
  /** plugin_install / model_request: the plugin or model asked for. */
  subject?: string;
  note?: string;
}

export function createAccessRequest(body: NewAccessRequest, token: string) {
  return apiFetch<MyAccessRequest>("/v1/access-requests", { method: "POST", body, token });
}

export function fetchMyAccessRequests(token: string, signal?: AbortSignal) {
  return apiFetch<ListResponse<MyAccessRequest>>("/v1/access-requests", { token, signal });
}

/** The requests routed to the caller; `status` "all" keeps the decided ones
 * (with who decided them) next to the pending ones. */
export function fetchRequestInbox(
  status: "pending" | "all",
  token: string,
  signal?: AbortSignal,
) {
  return apiFetch<ListResponse<InboxRequest>>(`/v1/access-requests/inbox?status=${status}`, {
    token,
    signal,
  });
}

export function approveAccessRequest(orgId: number, requestId: number, token: string) {
  return apiFetch<{ access_request: InboxRequest; follow_up?: string | null }>(
    `/v1/organizations/${orgId}/access-requests/${requestId}/approve`,
    { method: "POST", body: {}, token },
  );
}

export function denyAccessRequest(
  orgId: number,
  requestId: number,
  reason: string,
  token: string,
) {
  return apiFetch<InboxRequest>(`/v1/organizations/${orgId}/access-requests/${requestId}/deny`, {
    method: "POST",
    body: reason ? { reason } : {},
    token,
  });
}

/** Why a new request was refused, when the API says so in a known way. */
export type CreateRefusal =
  | { code: "exists" }
  | { code: "cooldown"; until: string | null; reason: string | null };

export function createRefusal(e: unknown): CreateRefusal | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null;
  if (e.message === "access_request_exists") return { code: "exists" };
  const detail = (e.body as { detail?: unknown } | null)?.detail as
    | { code?: string; cooldown_until?: string; decision_reason?: string }
    | undefined;
  if (detail && typeof detail === "object" && detail.code === "request_cooldown") {
    return {
      code: "cooldown",
      until: detail.cooldown_until ?? null,
      reason: detail.decision_reason ?? null,
    };
  }
  return null;
}

/** The API's answer when another recipient decided the request first. */
export function isAlreadyDecided(e: unknown): boolean {
  return e instanceof ApiError && e.status === 409 && e.message === "access_request_not_pending";
}

/** The permission that decides each kind (the API's review permissions):
 * team joins by the team's admins or `org.teams.manage`, plugins and models by
 * `org.settings.manage`, plans by `org.billing.manage`. */
export const REVIEW_KEYS: readonly PermissionKey[] = [
  "team.members.manage",
  "org.teams.manage",
  "org.settings.manage",
  "org.billing.manage",
];

/** May the caller decide any kind of request (inbox and menu badge)? */
export function useCanDecideRequests(): boolean {
  const access = useAccess();
  return REVIEW_KEYS.some((key) => access.can(key));
}

/** The active org's id, or null for a token without one. */
export function useActiveOrgId(): number | null {
  const { activeTenantId, tenantId } = useAuth();
  const id = Number(activeTenantId || tenantId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const REQUESTS_CHANGED_EVENT = "minder:requests-changed";

/** Tell the menu badge a request was sent or decided, so it recounts. */
export function notifyRequestsChanged(): void {
  window.dispatchEvent(new Event(REQUESTS_CHANGED_EVENT));
}

/** How many requests wait for the caller's decision (the menu badge); 0 for
 * a caller who can't decide any, without asking the API. */
export function usePendingRequestCount(): number {
  const { token, sessionKey } = useAuth();
  const canDecide = useCanDecideRequests();
  const res = useAsyncResource((signal) => fetchRequestInbox("pending", token, signal), {
    enabled: canDecide && !!token,
    deps: [sessionKey],
  });
  const { reload } = res;
  useEffect(() => {
    if (!canDecide) return;
    window.addEventListener(REQUESTS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(REQUESTS_CHANGED_EVENT, reload);
  }, [canDecide, reload]);
  return canDecide ? (res.data?.total ?? 0) : 0;
}

/**
 * The request a caller locked out of `requires` could send, or null when
 * there is none. Page access itself is not a request kind the API knows, so
 * the forbidden page keeps its "Request access" action disabled.
 */
export function requestKindFor(requires: Requirement): AccessRequestKind | null {
  void requires;
  return null;
}
