import { useEffect, useState } from "react";

import { ApiError, apiFetch } from "./api";
import type { components } from "./api-types.gen";

/** What the sign-in page may offer (public `GET /v1/auth/capabilities`). */
export type AuthCapabilities = components["schemas"]["CapabilitiesResponse"];

/** The one error every failed reset confirm returns (400): unknown, expired,
 * already used or superseded token alike. */
export const INVALID_OR_EXPIRED_TOKEN = "invalid_or_expired_token";

export function fetchAuthCapabilities(signal?: AbortSignal): Promise<AuthCapabilities> {
  return apiFetch<AuthCapabilities>("/v1/auth/capabilities", { signal });
}

export interface AuthCapabilitiesState {
  /** True until the capabilities answer (or fail). */
  loading: boolean;
  /** What the server reported; `null` when the lookup failed (an older
   * gateway without the endpoint, a network error). Partial, because an
   * older gateway may not report every field. */
  capabilities: Partial<AuthCapabilities> | null;
}

/** The public auth capabilities, fetched once per mount. A page that needs
 * several of them (the sign-in page: password reset and registration mode)
 * calls this once and derives each from the result, so it makes one request. */
export function useAuthCapabilities(): AuthCapabilitiesState {
  const [state, setState] = useState<AuthCapabilitiesState>({
    loading: true,
    capabilities: null,
  });
  useEffect(() => {
    const controller = new AbortController();
    fetchAuthCapabilities(controller.signal)
      .then((caps) => {
        if (!controller.signal.aborted) {
          setState({ loading: false, capabilities: caps ?? null });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ loading: false, capabilities: null });
      });
    return () => controller.abort();
  }, []);
  return state;
}

/** Whether `capabilities` offer password reset by email. Unknown reads as
 * "not offered", so no link is shown that would lead to a dead end. */
export function passwordResetOffered(
  capabilities: Partial<AuthCapabilities> | null | undefined,
): boolean {
  return capabilities?.password_reset_email === true;
}

/** Whether this server offers password reset by email. `loading` is true
 * until the capabilities answer; any failure (an older gateway without the
 * endpoint, a network error) reads as "not offered", so no link is shown
 * that would lead to a dead end. */
export function usePasswordResetAvailable(): { loading: boolean; available: boolean } {
  const { loading, capabilities } = useAuthCapabilities();
  return { loading, available: passwordResetOffered(capabilities) };
}

/** Ask for a reset link. The gateway answers every well-formed request with
 * the same 202, whether or not the address has an account; only malformed
 * input (422) and its rate limit (429) differ, as an ApiError. */
export async function requestPasswordReset(email: string): Promise<void> {
  await apiFetch<unknown>("/v1/auth/password-reset/request", {
    method: "POST",
    body: { email },
  });
}

/** Set a new password with the token from a reset link (204). Every token
 * failure is a 400 `invalid_or_expired_token` ApiError. The reset ends every
 * session and never signs the user in. */
export async function confirmPasswordReset(
  token: string,
  newPassword: string,
): Promise<void> {
  await apiFetch<void>("/v1/auth/password-reset/confirm", {
    method: "POST",
    body: { token, new_password: newPassword },
  });
}

export function isInvalidResetTokenError(e: unknown): boolean {
  return e instanceof ApiError && e.status === 400 && e.message === INVALID_OR_EXPIRED_TOKEN;
}

/** Reads the reset token from the URL fragment (`#token=...`, where reset
 * emails put it so it never reaches a server log or a Referer header) and
 * immediately removes the fragment from the address bar and the history
 * entry. Returns null when the URL carries no token. */
export function takeResetTokenFromUrl(): string | null {
  const hash = window.location.hash;
  if (!hash) return null;
  const token = new URLSearchParams(hash.slice(1)).get("token");
  window.history.replaceState(
    window.history.state,
    "",
    window.location.pathname + window.location.search,
  );
  return token || null;
}

const RESET_EMAIL_KEY = "minder_password_reset_email";

/** The address last typed into a reset request in this tab (sessionStorage,
 * so it never outlives the tab), used to prefill a "send me a new link" form
 * when a link turns out to be expired. Storage failures are ignored. */
export function rememberResetEmail(email: string): void {
  try {
    sessionStorage.setItem(RESET_EMAIL_KEY, email);
  } catch {
    /* storage unavailable: nothing to prefill later */
  }
}

export function rememberedResetEmail(): string {
  try {
    return sessionStorage.getItem(RESET_EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

export function forgetResetEmail(): void {
  try {
    sessionStorage.removeItem(RESET_EMAIL_KEY);
  } catch {
    /* ignore */
  }
}
