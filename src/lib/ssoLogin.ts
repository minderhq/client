/** Binds the SSO callback to the login this browser started.
 *
 * Starting SSO stores a fresh random nonce (with a short expiry) in
 * sessionStorage and passes it to the gateway's /v1/auth/oidc/login as
 * `cnonce`. The gateway keeps it bound to that login server-side and echoes
 * it back in the /auth/callback fragment. AuthCallbackPage then adopts the
 * token only when a pending login exists and the echoed nonce matches it. The
 * pending state is single-use: it is cleared on every callback, match or not.
 */

export const PENDING_SSO_KEY = "minder_sso_pending";

/** How long a started SSO login stays acceptable. Longer than the gateway's
 * own 5-minute state cookie, so the gateway's limit is the one users hit. */
export const PENDING_SSO_TTL_MS = 10 * 60 * 1000;

interface PendingSsoLogin {
  nonce: string;
  expiresAt: number;
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 256 random bits, base64url-encoded (43 chars). */
export function generateSsoNonce(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** Record a pending SSO login and return the gateway login URL to navigate
 * to, carrying its nonce as `cnonce`. */
export function beginSsoLogin(loginUrl: string, now: number = Date.now()): string {
  const nonce = generateSsoNonce();
  const pending: PendingSsoLogin = { nonce, expiresAt: now + PENDING_SSO_TTL_MS };
  sessionStorage.setItem(PENDING_SSO_KEY, JSON.stringify(pending));
  const url = new URL(loginUrl, window.location.href);
  url.searchParams.set("cnonce", nonce);
  return url.toString();
}

/** Length-independent-time string comparison: avoids an early exit on the
 * first differing character. */
function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function readPending(): PendingSsoLogin | null {
  const raw = sessionStorage.getItem(PENDING_SSO_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as PendingSsoLogin).nonce === "string" &&
      typeof (parsed as PendingSsoLogin).expiresAt === "number"
    ) {
      return parsed as PendingSsoLogin;
    }
  } catch {
    // Malformed entry -- treated as no pending login.
  }
  return null;
}

/** Consume the pending SSO login (always cleared) and report whether
 * `echoedNonce` completes it: one must exist, be unexpired, and match. */
export function completeSsoLogin(
  echoedNonce: string | null,
  now: number = Date.now(),
): boolean {
  const pending = readPending();
  sessionStorage.removeItem(PENDING_SSO_KEY);
  if (!pending || !echoedNonce || !pending.nonce) return false;
  if (now > pending.expiresAt) return false;
  return constantTimeEqual(pending.nonce, echoedNonce);
}
