/** Pure JWT-claim helpers, split out of auth.tsx so they're unit-testable
 * without rendering the AuthProvider — and so auth.tsx stays a
 * components-only module (React Fast Refresh only works cleanly when a file
 * exports components alone). #502 */

export interface JwtClaims {
  username: string;
  email: string;
  role: string;
  exp: number; // seconds since epoch; 0 when the token carries no expiry
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

/** True once the token's `exp` has passed. Tokens without an `exp` (exp === 0)
 * are treated as non-expiring so this never regresses such tokens to logged-out. */
export function isExpired(exp: number): boolean {
  return exp > 0 && Date.now() >= exp * 1000;
}

/** Decode the display claims (username/email/role/exp) straight from a JWT's
 * payload segment. Malformed/absent input fails open into empty strings + exp 0
 * rather than throwing: a broken token should read as "not really logged in",
 * not crash the app. Every claim lives in the token already, so decoding it
 * fresh keeps exactly one source of truth for "who is this" regardless of which
 * path (local login, SSO callback, reload from sessionStorage) produced it. */
const EMPTY_CLAIMS: JwtClaims = {
  username: "",
  email: "",
  role: "",
  exp: 0,
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
      username: typeof decoded.username === "string" ? decoded.username : "",
      email: typeof decoded.email === "string" ? decoded.email : "",
      role: typeof decoded.role === "string" ? decoded.role : "",
      exp: typeof decoded.exp === "number" ? decoded.exp : 0,
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
