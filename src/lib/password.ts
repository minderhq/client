import { adoptAccessToken, apiFetch } from "./api";

/** Minimum length the gateway enforces for a new password — the same floor
 * as registration (api-gateway's ChangePasswordRequest / RegisterRequest). */
export const MIN_PASSWORD_LENGTH = 8;

/** Maximum size of a new password in UTF-8 bytes. bcrypt reads only 72
 * bytes, so the gateway refuses anything longer with a 422
 * (ChangePasswordRequest / PasswordResetConfirmBody). */
export const MAX_PASSWORD_BYTES = 72;

/** A new password that breaks the policy: which field to fix, and why. */
export interface NewPasswordProblem {
  field: "password" | "confirmation";
  message: string;
}

/** Checks a new password against the gateway's password policy before it is
 * sent: at least MIN_PASSWORD_LENGTH characters, at most MAX_PASSWORD_BYTES
 * UTF-8 bytes, and equal to its confirmation. Characters are counted as
 * Unicode code points, as the gateway (pydantic `min_length`) counts them, not
 * as UTF-16 units: an emoji counts as one. Returns the problem, or null when
 * the password is acceptable. */
export function newPasswordProblem(
  password: string,
  confirmation: string,
): NewPasswordProblem | null {
  if ([...password].length < MIN_PASSWORD_LENGTH) {
    return {
      field: "password",
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
    return {
      field: "password",
      message: `Password is too long. Use at most ${MAX_PASSWORD_BYTES} bytes (fewer characters if it contains accented letters or symbols).`,
    };
  }
  if (password !== confirmation) {
    return { field: "confirmation", message: "Passwords don't match." };
  }
  return null;
}

/** Change the authenticated caller's OWN local password
 * (POST /v1/auth/change-password).
 *
 * The account is taken from the bearer token, never the body. The gateway
 * answers a wrong current password with 400 (not 401, so it never reads as an
 * expired session), and an SSO-linked account with 409 — its password lives
 * in the Authelia portal. Both surface as an ApiError with the server's
 * message.
 *
 * A password change revokes every session of the account, including this one,
 * and answers 200 with a replacement token in the
 * refresh shape. It is adopted here, so this device stays signed in while all
 * others end (#62). An older gateway's 204 (no body) is still accepted.
 * Resolves to the token now in use. */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
  token: string,
): Promise<string | null> {
  const sentAt = Date.now();
  const data = await apiFetch<{ access_token?: unknown } | undefined>(
    "/v1/auth/change-password",
    {
      method: "POST",
      body: { current_password: currentPassword, new_password: newPassword },
      token,
    },
  );
  if (data && typeof data.access_token === "string" && data.access_token) {
    return adoptAccessToken(token, data.access_token, sentAt);
  }
  return token;
}
