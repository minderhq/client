import { useEffect } from "react";

/** Helpers for pages opened from an emailed account link that carries a
 * one-time secret in the URL fragment, e.g. `/reset-password#token=…` (email
 * ADR Decision 5, "Links"). The fragment is never sent to any server, so the
 * secret stays out of the page request, proxy logs and `Referer`. The page
 * reads it once, removes it from the address bar, and POSTs it only when the
 * user explicitly submits.
 *
 * Every route that uses these helpers must also be listed in nginx.conf's
 * token-route location (`Referrer-Policy: no-referrer`, `Cache-Control:
 * no-store`) and in nginxConfig.test.ts's TOKEN_ROUTES, which checks that
 * location. */

/** Upper bound the gateway accepts for an account token
 * (`PasswordResetConfirmBody.token`, max_length 128). Anything longer is not
 * a real token, so it's treated as missing rather than POSTed. */
const MAX_TOKEN_LENGTH = 128;

/** Returns the `token` parameter from a URL fragment such as `#token=…`, or
 * null when it's absent, empty, malformed or implausibly long. Matches the
 * parameter at the start of the fragment or after an `&` only, so a
 * `#xtoken=` or `#a=token=` can't pass for it. */
export function readFragmentToken(hash: string): string | null {
  const match = hash.match(/(?:^#|&)token=([^&]*)/);
  if (!match || !match[1]) return null;
  let token: string;
  try {
    token = decodeURIComponent(match[1]);
  } catch {
    return null; // malformed percent-encoding
  }
  token = token.trim();
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  return token;
}

/** Removes the fragment from the address bar without a navigation or a new
 * history entry (`history.replaceState`). The path, query string and the
 * router's own history state are kept, so React Router is undisturbed, and
 * the secret leaves both the visible URL and this history entry, so going Back
 * or Forward can't bring it back. */
export function clearUrlFragment(): void {
  if (typeof window === "undefined" || !window.location.hash) return;
  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, "", pathname + search);
}

/** While the calling page is mounted, adds `<meta name="referrer"
 * content="no-referrer">`. It's the fallback for the `Referrer-Policy:
 * no-referrer` header that nginx sets on token routes, for hosts that serve
 * the bundle without nginx.conf (the Vite dev server, another static host).
 * The previous referrer meta, if any, is restored on unmount. */
export function useNoReferrerMeta(): void {
  useEffect(() => {
    const existing = document.head.querySelector<HTMLMetaElement>(
      'meta[name="referrer"]',
    );
    const previous = existing?.content ?? null;
    const meta = existing ?? document.createElement("meta");
    meta.name = "referrer";
    meta.content = "no-referrer";
    if (!existing) document.head.appendChild(meta);
    return () => {
      if (previous === null) meta.remove();
      else meta.content = previous;
    };
  }, []);
}
