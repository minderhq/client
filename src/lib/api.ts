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
  sessionStorage.removeItem(TOKEN_KEY);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
}

// The one in-flight refresh, shared by every caller (#53): N requests that
// 401 at once -- or a 401 racing the scheduled pre-expiry refresh -- all await
// the same POST instead of stampeding the endpoint.
let refreshInFlight: Promise<string | null> | null = null;

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
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const res = await fetch(`${apiBaseUrl}/v1/auth/refresh`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) return null;
      if (!res.ok) throw new ApiError(await parseErrorDetail(res), res.status);
      const data = (await res.json()) as { access_token?: unknown };
      if (typeof data.access_token !== "string" || !data.access_token) {
        throw new ApiError("Refresh response carried no access token", res.status);
      }
      // The session moved on while the refresh was in flight: logout (storage
      // cleared) or a token swap (switchOrg / loginWithToken). Don't resurrect
      // the old session over it -- hand back whatever is current instead.
      const current = sessionStorage.getItem(TOKEN_KEY);
      if (current !== token) return current;
      sessionStorage.setItem(TOKEN_KEY, data.access_token);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(TOKEN_REFRESHED_EVENT, { detail: data.access_token }),
        );
      }
      return data.access_token;
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/** Parses the error body and throws the resulting ApiError -- shared by
 * apiFetch and apiFetchBlob so the 401 handling above only lives in one
 * place. Always throws; the `Promise<never>` return type lets callers
 * `return throwApiError(res)` regardless of their own return type. */
async function throwApiError(res: Response): Promise<never> {
  const detail = await parseErrorDetail(res);
  if (res.status === 401) handleUnauthorized();
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
 * throwApiError to turn into the usual logout. */
async function sendWithRefresh(
  path: string,
  { method = "GET", body, token, signal }: ApiOptions,
): Promise<Response> {
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
  if (res.status !== 401 || !token) return res;

  // No stored token at all means the session is already gone (logged out).
  const stored = sessionStorage.getItem(TOKEN_KEY);
  if (!stored) return res;
  let fresh: string | null = null;
  if (stored !== token) {
    // Another request (or the scheduled refresh) already swapped in a newer
    // token than the one this caller captured -- replay with that instead of
    // refreshing again.
    fresh = stored;
  } else {
    try {
      fresh = await refreshAccessToken(token);
    } catch {
      fresh = null; // transient refresh failure: the original 401 stands
    }
  }
  return fresh ? send(fresh) : res;
}

/** Thin fetch wrapper: prefixes the gateway base URL, injects the bearer
 * token when present, and centralizes JSON parsing + error handling --
 * replacing the copy-pasted try/catch blocks the old plugin_config.html and
 * model_management.html each carried independently. */
export async function apiFetch<T>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const res = await sendWithRefresh(path, options);

  if (!res.ok) return throwApiError(res);

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
  const res = await sendWithRefresh(path, options);

  if (!res.ok) return throwApiError(res);

  return { blob: await res.blob(), headers: res.headers };
}
