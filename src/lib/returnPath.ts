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

/** Remember a return path across the full-page SSO round trip. */
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
