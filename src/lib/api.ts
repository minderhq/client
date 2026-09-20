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

/** Clears the stale token and tells the rest of the app (AuthProvider) that
 * the session is gone. Called once per 401 response, from both apiFetch and
 * apiFetchBlob. Idempotent -- safe to call repeatedly. */
function handleUnauthorized(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
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

/** Thin fetch wrapper: prefixes the gateway base URL, injects the bearer
 * token when present, and centralizes JSON parsing + error handling --
 * replacing the copy-pasted try/catch blocks the old plugin_config.html and
 * model_management.html each carried independently. */
export async function apiFetch<T>(
  path: string,
  { method = "GET", body, token, signal }: ApiOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  const isFormData = body instanceof FormData;
  // Never set Content-Type for FormData -- the browser fills in the
  // multipart boundary itself; a manually-set header drops it and breaks
  // parsing server-side.
  if (body !== undefined && !isFormData) {
    headers["Content-Type"] = "application/json";
  }
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers,
    body:
      body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
    signal,
  });

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
  { method = "GET", body, token, signal }: ApiOptions = {},
): Promise<{ blob: Blob; headers: Headers }> {
  const headers: Record<string, string> = {};
  const isFormData = body instanceof FormData;
  if (body !== undefined && !isFormData) {
    headers["Content-Type"] = "application/json";
  }
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers,
    body:
      body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
    signal,
  });

  if (!res.ok) return throwApiError(res);

  return { blob: await res.blob(), headers: res.headers };
}
