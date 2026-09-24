import { apiFetch } from "./api";

/** Minimum length the gateway enforces for a new password — the same floor
 * as registration (api-gateway's ChangePasswordRequest / RegisterRequest). */
export const MIN_PASSWORD_LENGTH = 8;

/** Change the authenticated caller's OWN local password
 * (POST /v1/auth/change-password, 204 on success; minderhq/minder#1776).
 *
 * The account is taken from the bearer token, never the body. The gateway
 * answers a wrong current password with 400 (not 401, so it never reads as an
 * expired session), and an SSO-linked account with 409 — its password lives
 * in the Authelia portal. Both surface as an ApiError with the server's
 * message. */
export function changePassword(
  currentPassword: string,
  newPassword: string,
  token: string,
) {
  return apiFetch<void>("/v1/auth/change-password", {
    method: "POST",
    body: { current_password: currentPassword, new_password: newPassword },
    token,
  });
}
