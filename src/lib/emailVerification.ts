import { useCallback } from "react";

import { ApiError, apiFetch, friendlyErrorMessage, refreshAccessToken } from "./api";
import { useAuth } from "./auth";
import type { AuthCapabilities } from "./passwordReset";
import { useTokenRef } from "./useTokenRef";

/** Registration email verification (#2447, backend #1807).
 *
 * An account created through open sign-up must confirm its email address
 * before it can be used. Until then its token reaches only an allowlist
 * (resend, change-password, the profile read); everything else answers `403
 * email_verification_required`. The emailed link is
 * `/verify-email#token=mev_...`: the token sits in the fragment so it never
 * reaches a server log, and it is only sent on an explicit press. Both routes
 * 404 when the server has no email configured. */

/** The capabilities fields this flow reads; `email_verify_link_hours` is
 * newer than the published spec the generated types come from. */
export type VerificationCapabilities = Partial<AuthCapabilities> & {
  email_verify_link_hours?: number | null;
};

/** How long a verification link works, in hours, or null when unknown. */
export function verifyLinkHours(
  capabilities: VerificationCapabilities | null | undefined,
): number | null {
  const h = capabilities?.email_verify_link_hours;
  return typeof h === "number" && Number.isFinite(h) && h > 0 ? h : null;
}

/** The wait used when a 429 carries no readable `Retry-After` (the gateway's
 * minimum interval between two sends). */
export const DEFAULT_RESEND_COOLDOWN_SECONDS = 60;

/** The wait a 429 asks for: the `Retry-After` header, else a
 * `retry_after_seconds` in the body (for when the header isn't exposed to
 * the page by CORS), else {@link DEFAULT_RESEND_COOLDOWN_SECONDS}. */
export function rateLimitWait(e: ApiError): number {
  if (e.retryAfterSeconds !== null) return e.retryAfterSeconds;
  const fromBody = (e.body as { retry_after_seconds?: unknown } | null)?.retry_after_seconds;
  return typeof fromBody === "number" && Number.isFinite(fromBody) && fromBody >= 0
    ? Math.ceil(fromBody)
    : DEFAULT_RESEND_COOLDOWN_SECONDS;
}

export type VerifyResult =
  | { kind: "verified"; organizationId: number | null }
  /** The link was real but its lifetime ran out: offer a new one first. */
  | { kind: "expired" }
  /** Unknown, already used, or replaced by a newer link. */
  | { kind: "invalid" }
  | { kind: "rate_limited"; retryAfterSeconds: number }
  /** The server has no email verification (both routes 404). */
  | { kind: "unavailable" }
  | { kind: "error"; message: string };

/** Confirm the address with the link's token (`POST /v1/auth/verify-email`,
 * unauthenticated: the token is the proof, so the link works on any device).
 * Never throws; the token is never logged. */
export async function confirmEmailVerification(token: string): Promise<VerifyResult> {
  try {
    const res = await apiFetch<{ organization_id?: unknown }>("/v1/auth/verify-email", {
      method: "POST",
      body: { token },
    });
    const org = res?.organization_id;
    return {
      kind: "verified",
      organizationId: typeof org === "number" && Number.isFinite(org) ? org : null,
    };
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 400) {
        const reason = (e.body as { reason?: unknown } | null)?.reason;
        return reason === "expired" ? { kind: "expired" } : { kind: "invalid" };
      }
      if (e.status === 429) {
        return {
          kind: "rate_limited",
          retryAfterSeconds: rateLimitWait(e),
        };
      }
      if (e.status === 404) return { kind: "unavailable" };
    }
    return { kind: "error", message: friendlyErrorMessage(e) };
  }
}

export type ResendResult =
  | { kind: "sent"; retryAfterSeconds: number }
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "already_verified" }
  /** The address can't be mailed (bounced, suppressed). */
  | { kind: "undeliverable" }
  /** Nothing to verify (e.g. an SSO account). */
  | { kind: "not_applicable" }
  | { kind: "unavailable" }
  | { kind: "error"; message: string };

/** Send the signed-in account a new verification link
 * (`POST /v1/auth/verify-email/resend`); older links stop working. Never
 * throws. */
export async function resendVerificationEmail(token: string): Promise<ResendResult> {
  try {
    const res = await apiFetch<{ retry_after_seconds?: unknown }>(
      "/v1/auth/verify-email/resend",
      { method: "POST", token },
    );
    const wait = res?.retry_after_seconds;
    return {
      kind: "sent",
      retryAfterSeconds:
        typeof wait === "number" && Number.isFinite(wait) && wait >= 0
          ? wait
          : DEFAULT_RESEND_COOLDOWN_SECONDS,
    };
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 429) {
        return {
          kind: "rate_limited",
          retryAfterSeconds: rateLimitWait(e),
        };
      }
      if (e.status === 409) {
        if (e.message === "email_already_verified") return { kind: "already_verified" };
        if (e.message === "email_undeliverable") return { kind: "undeliverable" };
        if (e.message === "email_verification_not_applicable") {
          return { kind: "not_applicable" };
        }
      }
      if (e.status === 404) return { kind: "unavailable" };
    }
    return { kind: "error", message: friendlyErrorMessage(e) };
  }
}

/** A wait in words: "45 seconds", "2 minutes", "3 hours". */
export function formatWait(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 60) return `${s} second${s === 1 ? "" : "s"}`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.ceil(m / 60);
  return `${h} hour${h === 1 ? "" : "s"}`;
}

/** Once the address is confirmed, swap the signed-in session's restricted
 * token for a full one (the refresh also carries the personal workspace a
 * verification may just have created) and adopt it as a new session, so
 * every gate re-reads the profile. The login's "email not confirmed" flag is
 * cleared only once that worked. Resolves to false when the server refused
 * the refresh (the session is over: signed out); rejects on a transient
 * failure, leaving everything as it was. With no session it only clears the
 * flag. */
export function useContinueAfterVerification(): () => Promise<boolean> {
  const { loginWithToken, clearEmailVerificationRequired, logout } = useAuth();
  const tokenRef = useTokenRef();
  return useCallback(async () => {
    const token = tokenRef.current;
    if (!token) {
      clearEmailVerificationRequired();
      return true;
    }
    const sentAt = Date.now();
    // Rejects on a transient failure (network, 5xx): the flag then stays set,
    // so the caller can offer a retry instead of a restricted session.
    const fresh = await refreshAccessToken(token);
    if (!fresh) {
      logout(); // clears the flag too
      return false;
    }
    clearEmailVerificationRequired();
    loginWithToken(fresh, sentAt);
    return true;
  }, [tokenRef, loginWithToken, clearEmailVerificationRequired, logout]);
}
