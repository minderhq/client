/** Schemes an `href` built from API-supplied data may use. Anything else
 * (`javascript:`, `data:`, `vbscript:`, `file:`, a relative path, …) is never
 * rendered as a link. */
const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:"]);

/** Returns a normalized absolute http(s) URL for `raw`, or null when `raw` is
 * empty, unparseable, relative, or uses any other scheme.
 *
 * Use it before putting a user- or API-supplied string into an `href`. React
 * escapes text but not URL schemes, so `<a href={value}>` with a
 * `javascript:` value is still an XSS sink. The backend's `HttpUrl` validation
 * on write isn't enough: legacy rows and other writers can bypass it. */
export function safeExternalUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    // No base URL on purpose: a relative value must not resolve against this
    // console's own origin and turn into a same-site link.
    url = new URL(trimmed);
  } catch {
    return null;
  }
  return SAFE_LINK_PROTOCOLS.has(url.protocol) ? url.href : null;
}
