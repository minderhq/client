/** Public account-recovery routes that ForcePasswordChangeGate never covers.
 *
 * The gate keeps a signed-in user from using the app with a password an
 * administrator knows. These pages make no authenticated call and grant
 * nothing, so letting them through doesn't weaken that. Gating them would:
 * a reset link opened in a gated tab would never mount ResetPasswordPage, so
 * its token would stay in the address bar and the link couldn't be used.
 * On the reset page a signed-in user is asked to sign out first, which also
 * clears the forced-change flag. */
const GATE_EXEMPT_PATHS = new Set(["/reset-password", "/forgot-password"]);

/** Whether `pathname` is a gate-exempt route, matched the way React Router
 * matches it: case-insensitively, with or without a trailing slash. */
export function isGateExemptPath(pathname: string): boolean {
  return GATE_EXEMPT_PATHS.has(pathname.toLowerCase().replace(/\/+$/, ""));
}
