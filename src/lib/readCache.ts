/**
 * Shared short-lived cache for GET reads (#141).
 *
 * Every page used to re-fetch the same lists on mount (subscription, orgs,
 * models, bundles, pipelines, knowledge bases...), and quick navigation ran
 * into the gateway's rate limit. apiFetch routes a GET through here when the
 * caller opts in with `cache: true`:
 *
 *  - **Keyed by session + path.** The session part is the bearer token the
 *    request carries ("" for an anonymous request), so an entry is only ever
 *    served to a caller holding the very same token: never across users, orgs
 *    or sessions. Every session change (login, org switch, logout) also clears
 *    the whole cache (`clearReadCache`, called from AuthProvider).
 *  - **Short TTL** (`READ_CACHE_TTL_MS`): a hit only saves a navigation's
 *    worth of repeat requests; nothing stays stale for long.
 *  - **In-flight de-duplication**: callers asking for the same key at once
 *    share one request.
 *  - **Invalidation on writes**: apiFetch calls `invalidateReads(path)` for
 *    every non-GET, which drops every entry under the same top-level resource
 *    (`/v1/rag/...` for `/v1/rag/knowledge-bases/7/upload`). Deliberately
 *    coarse: invalidating too much costs one request, too little shows stale
 *    data.
 *
 * Errors are never cached. Values are shared by reference between callers, so
 * treat them as read-only (React state updates already copy).
 */

export const READ_CACHE_TTL_MS = 30_000;

interface Entry {
  /** The path without its session, for prefix invalidation. */
  path: string;
  /** Set once the request resolved; absent while in flight. */
  value?: unknown;
  hasValue: boolean;
  expiresAt: number;
  pending?: Promise<unknown>;
}

const entries = new Map<string, Entry>();

function cacheKey(session: string, path: string): string {
  return `${session}\n${path}`;
}

/** The top-level resource a path belongs to: `/v1/<first segment>` for
 * versioned API paths (`/v1/rag/pipeline?limit=1` -> `/v1/rag`), else its
 * first segment. Query strings and trailing segments are ignored. */
export function resourcePrefix(path: string): string {
  const segments = path.split(/[?#]/, 1)[0].split("/").filter(Boolean);
  const depth = /^v\d+$/.test(segments[0] ?? "") ? 2 : 1;
  return `/${segments.slice(0, depth).join("/")}`;
}

function pruneExpired(now: number): void {
  for (const [key, entry] of entries) {
    if (entry.hasValue && entry.expiresAt <= now) entries.delete(key);
  }
}

/** Rejects with an AbortError as soon as `signal` aborts; otherwise settles
 * like `promise`. Lets one caller give up on a shared request without
 * cancelling it for the others. */
function withSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  const abortError = () =>
    signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The operation was aborted.", "AbortError");
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

/** Returns the cached value for (`session`, `path`) when it is still fresh,
 * joins the request already in flight for it, or calls `load` (without the
 * caller's signal -- the request may be shared) and caches what it resolves
 * to. `signal` only detaches this caller. */
export function cachedRead<T>(
  session: string,
  path: string,
  load: () => Promise<T>,
  { signal, ttlMs = READ_CACHE_TTL_MS }: { signal?: AbortSignal; ttlMs?: number } = {},
): Promise<T> {
  const key = cacheKey(session, path);
  const now = Date.now();
  const existing = entries.get(key);
  if (existing) {
    if (existing.hasValue && existing.expiresAt > now) {
      return withSignal(Promise.resolve(existing.value as T), signal);
    }
    if (existing.pending) return withSignal(existing.pending as Promise<T>, signal);
  }

  pruneExpired(now);
  const entry: Entry = { path, hasValue: false, expiresAt: 0 };
  const pending = load().then(
    (value) => {
      // Only store if nobody invalidated (or replaced) this entry meanwhile:
      // a read that raced a write must not repopulate the cache.
      if (entries.get(key) === entry) {
        entry.value = value;
        entry.hasValue = true;
        entry.expiresAt = Date.now() + ttlMs;
        entry.pending = undefined;
      }
      return value;
    },
    (err: unknown) => {
      if (entries.get(key) === entry) entries.delete(key);
      throw err;
    },
  );
  entry.pending = pending;
  entries.set(key, entry);
  return withSignal(pending, signal);
}

/** Drops every cached or in-flight read under `path`'s top-level resource,
 * for every session. */
export function invalidateReads(path: string): void {
  const prefix = resourcePrefix(path);
  for (const [key, entry] of entries) {
    const entryPrefix = resourcePrefix(entry.path);
    if (entryPrefix === prefix) entries.delete(key);
  }
}

/** Forgets everything: on logout and every session change. */
export function clearReadCache(): void {
  entries.clear();
}
