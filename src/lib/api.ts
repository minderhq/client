import { decodeJwtClaims } from "./jwt";

// VITE_API_BASE_URL is baked in at BUILD time (Vite convention), not read at
// container start like every Python service's env vars -- changing it means
// rebuilding the image, not just restarting the container. See
// docker/docker-compose.yml's client build.args and .env.example.
export const apiBaseUrl: string =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

// OIDC/SSO entry point — a full-page navigation into Authelia's forward-auth +
// OIDC authorize flow, which only exists at a real Traefik hostname with valid
// DNS + TLS. So there is NO default (mirroring `autheliaPortalUrl` below): the
// old fallback baked in `https://api.minder.local/...`, which just dead-ends
// over a plain localhost/LAN address (the host doesn't resolve). A real SSO
// deployment sets VITE_OIDC_LOGIN_URL to its gateway URL; when unset the SSO
// button is hidden and local login (LoginPage) — the path that actually
// completes over localhost — is the only option shown.
export const oidcLoginUrl: string =
  import.meta.env.VITE_OIDC_LOGIN_URL || "";

// The Authelia self-service portal (change password / display name / groups).
// Deployment-specific and only reachable over real DNS + TLS, so there is NO
// hardcoded default — over a plain localhost/LAN address the portal isn't up,
// and a dead `https://authelia.minder.local` link (the old hardcoded value)
// just 404s. Baked at build time like the other VITE_* config; when unset the
// Settings page shows the guidance as plain text instead of a broken link.
export const autheliaPortalUrl: string =
  import.meta.env.VITE_AUTHELIA_PORTAL_URL || "";

// Same sessionStorage key the old plugin_config.html/model_management.html
// pages used, kept for continuity across the migration (#422 -> this client).
// Defined here (rather than in auth.tsx, which imports apiBaseUrl from this
// module) so apiFetch/apiFetchBlob can clear it directly on a 401 without a
// circular import.
export const TOKEN_KEY = "minder_jwt";

// Local-clock time (ms) at which the stored token was received, kept beside it
// so the silent refresh (#53) can measure the token's lifetime on the client's
// own clock -- immune to client/server clock skew -- across a page reload.
export const TOKEN_RECEIVED_AT_KEY = "minder_jwt_received_at";

/** Stores a newly received token together with its local receive time. */
export function storeToken(jwt: string, receivedAt: number = Date.now()): void {
  sessionStorage.setItem(TOKEN_KEY, jwt);
  sessionStorage.setItem(TOKEN_RECEIVED_AT_KEY, String(receivedAt));
}

/** Removes the stored token and its receive time. */
export function clearStoredToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_RECEIVED_AT_KEY);
}

/** The local receive time recorded for `jwt`, or null when unknown (not the
 * stored token, or stored without one). */
export function tokenReceivedAt(jwt: string): number | null {
  if (!jwt || sessionStorage.getItem(TOKEN_KEY) !== jwt) return null;
  const at = Number(sessionStorage.getItem(TOKEN_RECEIVED_AT_KEY));
  return Number.isFinite(at) && at > 0 ? at : null;
}

// Dispatched on `window` whenever any apiFetch/apiFetchBlob call gets a 401 --
// AuthProvider (src/lib/auth.tsx) listens for this on mount and reacts by
// clearing its in-memory token, which flips `isAuthenticated` to false
// everywhere in the app (#46). Without this, an expired/invalid token just
// sits in sessionStorage and every in-flight or polling data-fetch call keeps
// firing and 401ing -- each page only ever showed its own dead-end
// `friendlyErrorMessage()` text, with nothing stopping the retries or getting
// the user back to a logged-out state.
export const SESSION_EXPIRED_EVENT = "minder:session-expired";

// Dispatched on `window` (as a CustomEvent whose `detail` is the new JWT)
// whenever refreshAccessToken() swaps in a fresh token, so AuthProvider can
// adopt it into React state -- the mirror image of SESSION_EXPIRED_EVENT (#53).
export const TOKEN_REFRESHED_EVENT = "minder:token-refreshed";

/** Clears the stale token and tells the rest of the app (AuthProvider) that
 * the session is gone. Called once per 401 response, from both apiFetch and
 * apiFetchBlob, and when a refresh is rejected. Idempotent -- safe to call
 * repeatedly. */
export function handleUnauthorized(): void {
  clearStoredToken();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
}

// The one in-flight refresh, shared by every caller (#53): N requests that
// 401 at once -- or a 401 racing the scheduled pre-expiry refresh -- all await
// the same POST instead of stampeding the endpoint.
interface RefreshResult {
  /** The token to use from now on, or null when the refresh was rejected. */
  token: string | null;
  /** True only when `token` was minted by this refresh from `from` -- false
   * when it is whatever the session had moved on to meanwhile. */
  minted: boolean;
  from: string;
}
let refreshInFlight: Promise<RefreshResult> | null = null;

/** Exchanges `token` for a fresh one via `POST /v1/auth/refresh` (the API
 * re-validates the account and re-mints from the still-valid bearer token), then
 * stores it and announces it via TOKEN_REFRESHED_EVENT (#53).
 *
 * Resolves to the new token, or to `null` when the API rejects the refresh with
 * 401/403 -- the session is really over (revoked, deactivated, password reset,
 * or the token already expired). Rejects on a transient failure (network error,
 * 5xx) so a caller can decide whether to retry. Single-flight: concurrent calls
 * share one request. Uses raw `fetch`, never apiFetch, so a failing refresh can
 * never trigger another refresh. Does NOT log out by itself -- callers do. */
export function refreshAccessToken(token: string): Promise<string | null> {
  return refreshOnce(token).then((r) => r.token);
}

function refreshOnce(token: string): Promise<RefreshResult> {
  if (!refreshInFlight) {
    refreshInFlight = (async (): Promise<RefreshResult> => {
      // Taken before the request, so the recorded receive time never runs
      // later than the server's `iat` (errs toward refreshing early).
      const sentAt = Date.now();
      const res = await fetch(`${apiBaseUrl}/v1/auth/refresh`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        return { token: null, minted: false, from: token };
      }
      if (!res.ok) throw new ApiError(await parseErrorDetail(res), res.status);
      const data = (await res.json()) as { access_token?: unknown };
      if (typeof data.access_token !== "string" || !data.access_token) {
        throw new ApiError("Refresh response carried no access token", res.status);
      }
      // The session moved on while the refresh was in flight: logout (storage
      // cleared) or a token swap (switchOrg / loginWithToken). Don't resurrect
      // the old session over it -- hand back whatever is current instead.
      const current = sessionStorage.getItem(TOKEN_KEY);
      if (current !== token) return { token: current, minted: false, from: token };
      storeToken(data.access_token, sentAt);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(TOKEN_REFRESHED_EVENT, { detail: data.access_token }),
        );
      }
      return { token: data.access_token, minted: true, from: token };
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/** Whether two tokens belong to the same user AND the same active org. A token
 * this request did not itself mint by refreshing (#53 review) is only replayed
 * if it passes this -- so a request made as one user/org is never silently
 * re-sent as another after a switchOrg or a different login. */
function sameSession(a: string, b: string): boolean {
  const ca = decodeJwtClaims(a);
  const cb = decodeJwtClaims(b);
  return (
    ca.userId === cb.userId &&
    (ca.activeTenantId || ca.tenantId) === (cb.activeTenantId || cb.tenantId)
  );
}

/** Parses the error body and throws the resulting ApiError -- shared by
 * apiFetch and apiFetchBlob so the 401 handling above only lives in one
 * place. Always throws; the `Promise<never>` return type lets callers
 * `return throwApiError(res)` regardless of their own return type. */
async function throwApiError(
  res: Response,
  { logoutOn401 = true }: { logoutOn401?: boolean } = {},
): Promise<never> {
  const detail = await parseErrorDetail(res);
  if (res.status === 401 && logoutOn401) handleUnauthorized();
  throw new ApiError(detail, res.status);
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Every page's catch block used `e instanceof Error ? e.message : String(e)`
 * verbatim -- which, for a 401, shows whatever raw string the backend's
 * HTTPException carries (e.g. "Not authenticated") instead of an actionable
 * message telling the user what to actually do about it. Only 1 of 10 pages
 * special-cased this. Centralized here so every page gets the same
 * treatment without each one re-deriving it. */
export function friendlyErrorMessage(e: unknown): string {
  if (e instanceof ApiError && e.status === 401) {
    return "Your session expired — log in again.";
  }
  return e instanceof Error ? e.message : String(e);
}

async function parseErrorDetail(res: Response): Promise<string> {
  const data = await res.json().catch(() => ({}) as { detail?: unknown });
  const detail = (data as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  // Some endpoints return a structured detail `{error: string, errors?: []}`
  // rather than a bare string -- e.g. plugin-registry's install-from-git route
  // (#1578), whose GitInstallError surfaces an SSRF/clone/manifest-validation
  // reason plus optional sub-errors. Show the human-readable message instead of
  // dumping the raw JSON object at the user. (FastAPI's own validation errors
  // are an ARRAY, which is excluded here and still falls through to stringify.)
  if (
    detail &&
    typeof detail === "object" &&
    !Array.isArray(detail) &&
    typeof (detail as { error?: unknown }).error === "string"
  ) {
    const d = detail as { error: string; errors?: unknown };
    return Array.isArray(d.errors) && d.errors.length > 0
      ? `${d.error}: ${d.errors.join("; ")}`
      : d.error;
  }
  if (detail !== undefined) return JSON.stringify(detail);
  return `Request failed (${res.status})`;
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  token?: string;
  // Optional AbortSignal so a caller (e.g. useAsyncResource) can cancel an
  // in-flight request on unmount / supersession / timeout. When the signal
  // aborts, fetch rejects with an AbortError the caller is expected to swallow.
  signal?: AbortSignal;
}

/** The shared list envelope every Minder `list` endpoint returns (#501):
 * `{items, total, limit, offset}`. `total` is the pre-slice count, so
 * `offset + items.length < total` means another page exists. */
export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/** Sends one request, attaching `token` as the bearer when present. On a 401
 * for an authenticated request, gets a fresh token (one shared refresh, #53) and
 * replays the request exactly once with it. Returns the final Response; a 401
 * that survives (refresh rejected/failed, or the replay 401s too) is left for
 * throwApiError to turn into the usual logout.
 *
 * `staleSession` is true when the replay was refused because the session had
 * meanwhile moved to a different user or org: only this stale request failed,
 * the stored session is valid, so the caller must NOT log out. */
async function sendWithRefresh(
  path: string,
  { method = "GET", body, token, signal }: ApiOptions,
): Promise<{ res: Response; staleSession: boolean }> {
  const isFormData = body instanceof FormData;
  const send = (bearer: string | undefined) => {
    const headers: Record<string, string> = {};
    // Never set Content-Type for FormData -- the browser fills in the
    // multipart boundary itself; a manually-set header drops it and breaks
    // parsing server-side.
    if (body !== undefined && !isFormData) {
      headers["Content-Type"] = "application/json";
    }
    if (bearer) headers["Authorization"] = `Bearer ${bearer}`;
    return fetch(`${apiBaseUrl}${path}`, {
      method,
      headers,
      body:
        body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
      signal,
    });
  };

  const res = await send(token);
  const done = { res, staleSession: false };
  if (res.status !== 401 || !token) return done;

  // No stored token at all means the session is already gone (logged out).
  const stored = sessionStorage.getItem(TOKEN_KEY);
  if (!stored) return done;
  // Another request (or the scheduled refresh) may already have swapped in a
  // newer token than the one this caller captured -- replay with that instead
  // of refreshing again. Otherwise refresh the caller's own token.
  let candidate: string | null = stored;
  let ours = false;
  if (stored === token) {
    try {
      const r = await refreshOnce(token);
      candidate = r.token; // null: refresh rejected -> usual logout
      ours = r.minted && r.from === token;
    } catch {
      return done; // transient refresh failure: the original 401 stands
    }
  }
  if (!candidate) return done;
  // Only replay as the same user and org (unless our own refresh minted it).
  if (!ours && !sameSession(token, candidate)) {
    return { res, staleSession: true };
  }
  return { res: await send(candidate), staleSession: false };
}

/** Thin fetch wrapper: prefixes the gateway base URL, injects the bearer
 * token when present, and centralizes JSON parsing + error handling --
 * replacing the copy-pasted try/catch blocks the old plugin_config.html and
 * model_management.html each carried independently. */
export async function apiFetch<T>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const { res, staleSession } = await sendWithRefresh(path, options);

  if (!res.ok) return throwApiError(res, { logoutOn401: !staleSession });

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Like apiFetch, but for endpoints that return a binary body (e.g. tts-stt's
 * synthesized WAV/MP3 audio) instead of JSON -- calling .json() on those
 * would throw. Returns the blob plus any response headers the caller asked
 * for (e.g. tts-stt's X-Language/X-Duration), since Blob itself carries no
 * header info. */
export async function apiFetchBlob(
  path: string,
  options: ApiOptions = {},
): Promise<{ blob: Blob; headers: Headers }> {
  const { res, staleSession } = await sendWithRefresh(path, options);

  if (!res.ok) return throwApiError(res, { logoutOn401: !staleSession });

  return { blob: await res.blob(), headers: res.headers };
}
