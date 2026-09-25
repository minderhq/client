/** Pure JWT-claim helpers, split out of auth.tsx so they're unit-testable
 * without rendering the AuthProvider — and so auth.tsx stays a
 * components-only module (React Fast Refresh only works cleanly when a file
 * exports components alone). #502 */

export interface JwtClaims {
  /** The token subject (`sub`) — the user's own id, stringified. Empty when the
   * token carries no `sub`. Used to recognise "my" row in a list the server keys
   * by user id (e.g. which plugin review is the caller's own, #1591). */
  userId: string;
  username: string;
  email: string;
  role: string;
  exp: number; // seconds since epoch; 0 when the token carries no expiry
  iat: number; // issued-at, seconds since epoch (server clock); 0 when absent
  // Multi-tenant (organization) claims — empty/false when the token predates the
  // tenancy spine or the user has no org yet. `tenantId` is the home org;
  // `activeTenantId` is the currently-switched-into org (they match until you
  // switch). `orgRole` is the role WITHIN the active org (owner/admin/member),
  // distinct from the instance-level `role`. See lib/nav.ts / OrgSwitcher.
  tenantId: string;
  activeTenantId: string;
  orgRole: string;
  isPlatformAdmin: boolean;
}

/** Refresh once this fraction of the token's lifetime has elapsed (#53),
 * leaving the last 20% as headroom for a slow or retried refresh. */
const REFRESH_AT_FRACTION = 0.8;
/** setTimeout's delay is a signed 32-bit int; anything larger fires at once. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/** When a token expires, on the LOCAL clock (ms since epoch; 0 = never).
 *
 * `exp` is stamped by the server's clock, so comparing it with `Date.now()`
 * is off by however far the client clock is skewed. With short token
 * lifetimes a few minutes of skew would schedule the refresh after real
 * expiry. Instead measure the token's own lifetime (`exp - iat`, both on the
 * server clock, so skew cancels out) from the local time it was received.
 * Falls back to the server-clock `exp` when `iat` or the receive time is
 * unknown (e.g. a session stored before the receive time was recorded). */
export function localExpiryMs(
  exp: number,
  iat: number,
  receivedAt: number | null,
): number {
  if (exp <= 0) return 0;
  if (iat > 0 && exp > iat && receivedAt !== null) {
    return receivedAt + (exp - iat) * 1000;
  }
  return exp * 1000;
}

/** How long from `now` until the silent refresh should run: once 80% of the
 * span from `startMs` (when the token was received, or `now` if unknown) to
 * `expiresAt` (from localExpiryMs) has elapsed, so a token adopted fresh
 * refreshes at 80% of its life and one picked up from sessionStorage late in
 * its life refreshes almost immediately. An already-expired token is due at
 * once (0): the client still tries one refresh (#56) -- the API may accept it
 * inside its grace window (minderhq/minder#1933), and otherwise rejects it
 * with 401/403, which logs out as before. `null` only when the token has no
 * expiry, so there is nothing to schedule. */
export function refreshDelayMs(
  expiresAt: number,
  startMs: number,
  now: number = Date.now(),
): number | null {
  if (expiresAt <= 0) return null;
  if (now >= expiresAt) return 0;
  const refreshAt = startMs + (expiresAt - startMs) * REFRESH_AT_FRACTION;
  return Math.min(Math.max(0, Math.floor(refreshAt - now)), MAX_TIMER_MS);
}

/** Decode the display claims (username/email/role/exp) straight from a JWT's
 * payload segment. Malformed/absent input fails open into empty strings + exp 0
 * rather than throwing: a broken token should read as "not really logged in",
 * not crash the app. Every claim lives in the token already, so decoding it
 * fresh keeps exactly one source of truth for "who is this" regardless of which
 * path (local login, SSO callback, reload from sessionStorage) produced it. */
const EMPTY_CLAIMS: JwtClaims = {
  userId: "",
  username: "",
  email: "",
  role: "",
  exp: 0,
  iat: 0,
  tenantId: "",
  activeTenantId: "",
  orgRole: "",
  isPlatformAdmin: false,
};

/** A claim that should be a string but might arrive as a number (tenant ids) —
 * coerce, treating anything else (null/undefined/object) as absent. */
function claimToString(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
}

/** A JWT payload segment → parsed JSON. Decodes the bytes as **UTF-8** (so
 * non-ASCII usernames/emails — İ, ş, ğ, ö, … — survive instead of turning into
 * mojibake, which plain `atob`'s Latin-1 output does) and pads url-safe base64
 * so `atob` doesn't throw on an unpadded segment. */
function decodePayload(seg: string): Record<string, unknown> {
  const b64 = seg.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

export function decodeJwtClaims(jwt: string): JwtClaims {
  try {
    const decoded = decodePayload(jwt.split(".")[1]);
    return {
      // `sub` is minted as the stringified user id (str(user["id"])); coerce a
      // stray number defensively, same as the tenant ids below.
      userId: claimToString(decoded.sub),
      username: typeof decoded.username === "string" ? decoded.username : "",
      email: typeof decoded.email === "string" ? decoded.email : "",
      role: typeof decoded.role === "string" ? decoded.role : "",
      exp: typeof decoded.exp === "number" ? decoded.exp : 0,
      iat: typeof decoded.iat === "number" ? decoded.iat : 0,
      // tenant ids are minted as strings; coerce a stray number defensively.
      tenantId: claimToString(decoded.tenant_id),
      activeTenantId: claimToString(decoded.active_tenant_id),
      orgRole: typeof decoded.org_role === "string" ? decoded.org_role : "",
      isPlatformAdmin: decoded.is_platform_admin === true,
    };
  } catch {
    return EMPTY_CLAIMS;
  }
}
