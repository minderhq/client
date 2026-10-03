/** Public account-recovery routes that ForcePasswordChangeGate never covers
 * (#2138).
 *
 * The gate exists so a signed-in user can't use the app with a password an
 * administrator knows. These pages make no authenticated call and grant
 * nothing, so letting them through doesn't weaken that. Gating them would do
 * harm: a reset link opened in a gated tab would never mount
 * ResetPasswordPage, so its token would stay in the address bar and the link
 * couldn't be used. Clearing the fragment ahead of the gate instead would
 * destroy the only copy of the link unused. A completed reset signs the tab
 * out, which also clears the forced-change flag. */
const GATE_EXEMPT_PATHS = new Set(["/reset-password", "/forgot-password"]);

/** Whether `pathname` is a gate-exempt route, matched the way React Router
 * matches it: case-insensitively, with or without a trailing slash. */
export function isGateExemptPath(pathname: string): boolean {
  return GATE_EXEMPT_PATHS.has(pathname.toLowerCase().replace(/\/+$/, ""));
}
