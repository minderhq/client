import { ApiError, friendlyErrorMessage } from "./api";
import { type AuthCapabilities, useAuthCapabilities } from "./passwordReset";

/** How this instance admits new local accounts (`registration_mode` from the
 * public `GET /v1/auth/capabilities`):
 * - `open`   -- anyone may create an account on the login page;
 * - `invite` -- an account can only be created from an invite link;
 * - `closed` -- no local sign-up at all (SSO or admin-provisioned accounts). */
export type RegistrationMode = "open" | "invite" | "closed";

/** Reads the mode the API reports. Missing (an API that predates the field)
 * is `null` = unknown, and callers fall back to today's open behaviour (the
 * API still refuses with a 403 code we explain). Any other unrecognised value
 * is treated as `invite`, because that is how the API itself treats it. */
export function parseRegistrationMode(value: unknown): RegistrationMode | null {
  if (typeof value !== "string" || !value) return null;
  if (value === "open" || value === "closed") return value;
  return "invite";
}

/** The registration mode in a capabilities answer (see
 * {@link parseRegistrationMode}); `null` when the lookup failed. */
export function registrationModeFrom(
  capabilities: Partial<AuthCapabilities> | null | undefined,
): RegistrationMode | null {
  return parseRegistrationMode(capabilities?.registration_mode);
}

export interface RegistrationModeState {
  /** `null` while loading, or when the API couldn't tell us. */
  mode: RegistrationMode | null;
  loading: boolean;
}

/** The instance's registration mode, from the public capabilities endpoint.
 * A failed lookup resolves to `mode: null` (unknown), never to an error the
 * page would have to show. `loading` is true from the first render, so a page
 * never flashes a sign-up form it is about to hide. */
export function useRegistrationMode(): RegistrationModeState {
  const { loading, capabilities } = useAuthCapabilities();
  return { mode: registrationModeFrom(capabilities), loading };
}

/** Stable `detail` codes the API returns (403) when it refuses to create an
 * account. `invite_cannot_create_account` is reserved for invites that may
 * only be accepted by an existing account. */
export type RegistrationRefusal =
  | "invite_required"
  | "invite_invalid"
  | "invite_email_mismatch"
  | "invite_cannot_create_account";

const REFUSALS: ReadonlySet<string> = new Set<RegistrationRefusal>([
  "invite_required",
  "invite_invalid",
  "invite_email_mismatch",
  "invite_cannot_create_account",
]);

/** The refusal code carried by a failed `register()` call, or null. */
export function registrationRefusal(e: unknown): RegistrationRefusal | null {
  if (e instanceof ApiError && e.status === 403 && REFUSALS.has(e.message)) {
    return e.message as RegistrationRefusal;
  }
  return null;
}

/** True when sign-up failed because the email already has an account (409),
 * so the useful next step is to sign in instead. */
export function isExistingEmail(e: unknown): boolean {
  return e instanceof ApiError && e.status === 409 && /email/i.test(e.message);
}

const REFUSAL_MESSAGES: Record<RegistrationRefusal, string> = {
  invite_required:
    "New accounts on this instance are created by invitation only. Ask an administrator of your organization to send you an invite link.",
  invite_invalid:
    "This invite can't be used any more: it has expired, been withdrawn, or already been used. Ask the person who invited you for a new link.",
  invite_email_mismatch:
    "This invite was sent to a different email address. Use the address the invite was sent to, or ask for an invite to your own address.",
  invite_cannot_create_account:
    "This invite can only be used by someone who already has an account. Sign in first, then accept the invite.",
};

/** A user-facing message for a failed sign-up: the refusal codes get plain
 * explanations; anything else uses the usual friendly error text. */
export function registrationErrorMessage(e: unknown): string {
  const refusal = registrationRefusal(e);
  if (refusal) return REFUSAL_MESSAGES[refusal];
  if (isExistingEmail(e)) {
    return "An account with this email already exists. Sign in instead.";
  }
  return friendlyErrorMessage(e);
}
