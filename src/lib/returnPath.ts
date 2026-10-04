/** Where to go after signing in, when sign-in was started from another page
 * (e.g. an invite link). Only same-origin, in-app paths are accepted, so a
 * crafted value can never send the user to another site. */

const RETURN_PATH_KEY = "minder_return_path";

/** `value` if it is a safe in-app path ("/..." but not "//..." or "/\\..."),
 * otherwise null. */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return null;
  }
  return value;
}

/** Remember a return path across the full-page SSO round trip.
 *
 * This is the one place the path is stored, and it may be an invite link
 * (`/invite/<token>`), i.e. a credential. It has to be stored: SSO leaves the
 * app for the identity provider and comes back to /auth/callback as a new
 * page load, so router state is gone. sessionStorage keeps it to this tab and
 * origin; it is written only on the SSO click, read once and removed by the
 * callback ({@link consumeReturnPath}), and a later visit to the login page
 * removes a copy left by an abandoned attempt ({@link forgetReturnPath}).
 * Local sign-in never stores it (it travels in router state). */
export function rememberReturnPath(path: string | null): void {
  const safe = safeReturnPath(path);
  if (safe) sessionStorage.setItem(RETURN_PATH_KEY, safe);
  else sessionStorage.removeItem(RETURN_PATH_KEY);
}

/** Read and clear the remembered return path (single use). */
export function consumeReturnPath(): string | null {
  const value = sessionStorage.getItem(RETURN_PATH_KEY);
  sessionStorage.removeItem(RETURN_PATH_KEY);
  return safeReturnPath(value);
}

/** Drop a remembered return path without using it: the login page calls this
 * on arrival, so an SSO attempt abandoned at the identity provider doesn't
 * leave an invite token in sessionStorage for the rest of the tab's life. */
export function forgetReturnPath(): void {
  sessionStorage.removeItem(RETURN_PATH_KEY);
}
