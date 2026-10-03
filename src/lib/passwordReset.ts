import { ApiError, apiFetch } from "./api";
import type { components } from "./api-types.gen";
import { useAsyncResource } from "./useAsyncResource";

type Schemas = components["schemas"];

/** Email password reset (email ADR Decision 6, gateway #2169). Every call
 * here is public and unauthenticated: no bearer token is sent, even when this
 * tab holds a session, so apiFetch's refresh-and-retry never runs for these
 * calls. Request and response shapes come from the generated gateway types. */

/** `GET /v1/auth/capabilities`: what the sign-in page may offer.
 * `password_reset_email` is true when email is configured and email password
 * reset is enabled. When it's false, the request and confirm routes aren't
 * mounted (404). */
export type AuthCapabilities = Schemas["CapabilitiesResponse"];

export function fetchAuthCapabilities(signal?: AbortSignal): Promise<AuthCapabilities> {
  return apiFetch<AuthCapabilities>("/v1/auth/capabilities", { signal });
}

/** The auth capabilities, loaded once on mount. `passwordResetEmail` is true
 * only when the gateway positively reports the capability. While loading, on
 * any error (older gateway without the route, network failure), and on an
 * unexpected body, it is false, so the reset entry point stays hidden. */
export function useAuthCapabilities(): {
  capabilities: AuthCapabilities | null;
  passwordResetEmail: boolean;
  loading: boolean;
} {
  const res = useAsyncResource((signal) => fetchAuthCapabilities(signal), {
    timeoutMs: 10_000,
  });
  return {
    capabilities: res.data,
    passwordResetEmail: res.data?.password_reset_email === true,
    loading: res.loading,
  };
}

/** The one confirmation shown after any accepted reset request. It's a fixed
 * client-side string, deliberately not the server's `detail`, so it's
 * identical whether or not the address has an account (enumeration-safe). */
export const RESET_REQUEST_CONFIRMATION =
  "If an account exists for that address, we've sent instructions to reset its password.";

/** How a reset request ended. None of these depends on whether the address
 * has an account. The gateway answers every such outcome with the same 202,
 * including a silently skipped request over the per-account limit.
 * - `accepted`: 202, show RESET_REQUEST_CONFIRMATION.
 * - `invalid_email`: 422, the address is malformed.
 * - `rate_limited`: 429, the per-IP limit (one-minute window).
 * - `unavailable`: 404, email reset is not enabled on this gateway. */
export type ResetRequestOutcome =
  | "accepted"
  | "invalid_email"
  | "rate_limited"
  | "unavailable";

/** `POST /v1/auth/password-reset/request`. Resolves to the outcome. Rejects
 * only on a network failure or an unexpected server error. */
export async function requestPasswordReset(email: string): Promise<ResetRequestOutcome> {
  try {
    await apiFetch<unknown>("/v1/auth/password-reset/request", {
      method: "POST",
      body: { email: email.trim() } satisfies Schemas["PasswordResetRequestBody"],
    });
    return "accepted";
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 422) return "invalid_email";
      if (e.status === 429) return "rate_limited";
      if (e.status === 404) return "unavailable";
    }
    throw e;
  }
}

/** How a reset confirmation ended.
 * - `reset`: 204. The password changed and every session of the account was
 *   revoked. The user signs in again (no auto-login).
 * - `invalid_token`: 400 `invalid_or_expired_token`, the one generic answer
 *   for any token failure (expired, used, superseded, malformed, unknown).
 * - `rejected_password`: 422, the password failed the server's policy.
 * - `rate_limited`: 429, the per-IP limit.
 * - `unavailable`: 404, email reset was turned off after the link was sent. */
export type ResetConfirmOutcome =
  | "reset"
  | "invalid_token"
  | "rejected_password"
  | "rate_limited"
  | "unavailable";

/** `POST /v1/auth/password-reset/confirm`. Call it only on an explicit submit,
 * never on page load (link scanners must not consume tokens). Resolves to the
 * outcome. Rejects only on a network failure or an unexpected server error. */
export async function confirmPasswordReset(
  token: string,
  newPassword: string,
): Promise<ResetConfirmOutcome> {
  try {
    await apiFetch<undefined>("/v1/auth/password-reset/confirm", {
      method: "POST",
      body: {
        token,
        new_password: newPassword,
      } satisfies Schemas["PasswordResetConfirmBody"],
    });
    return "reset";
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 400) return "invalid_token";
      if (e.status === 422) return "rejected_password";
      if (e.status === 429) return "rate_limited";
      if (e.status === 404) return "unavailable";
    }
    throw e;
  }
}
