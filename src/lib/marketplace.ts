// Typed calls + response shapes for the marketplace and plugin-registry APIs the
// Installed/Browse plugin pages read (#2193). This is the start of the single
// typed module #2198 asks for -- only the calls this change needs live here for
// now; the rest of the marketplace calls move in with #2198.
//
// The gateway's OpenAPI only describes these services as catch-all proxies
// (#2196), so `api-types.gen.ts` has nothing to offer yet: the shapes below are
// hand-written from the services' own response models. Fields are documented as
// the backend returns them; nothing here is synthesized client-side.

import { apiFetch } from "./api";
import type { Installation } from "./types";

/** Who put a catalog row on this installation: `first_party` rows are synced by
 * plugin-registry from the vendored plugin catalog (auto-approved), `submitted`
 * rows went through the developer submission + review flow (#402). Typed open
 * (`string & {}`) because the column is a free-form string server-side. */
export type PluginOrigin = "first_party" | "submitted" | (string & {});

/** A catalog row's lifecycle state: the marketplace's full `PluginStatus`
 * enum. The #402 submission flow is draft → submitted → in_review → approved
 * or rejected, and archived delists a plugin. `approved` is the publicly
 * visible state; `pending` is the legacy pre-#402 value, kept for back-compat. */
export type PluginStatus =
  | "draft"
  | "submitted"
  | "in_review"
  | "pending"
  | "approved"
  | "rejected"
  | "archived";

/** One marketplace catalog row (`GET /v1/marketplace/plugins`, the plugin
 * service's `PluginResponse`). */
export interface CatalogPlugin {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  author: string;
  repository_url: string | null;
  distribution_type: "git" | "docker" | "hybrid";
  docker_image: string | null;
  /** The version the catalog currently lists (plugin-registry's sync writes the
   * loaded plugin's own version here, #1625). */
  current_version: string | null;
  pricing_model: "free" | "paid" | "freemium";
  base_tier: string;
  status: PluginStatus;
  featured: boolean;
  download_count: number;
  rating_average: number | null;
  rating_count: number;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  developer_id: string | null;
  category_id: string | null;
  requires_services: string[];
  /** Screenshot/media image URLs shown as a gallery on the listing (#1521).
   * Additive: legacy listings and any plugin whose author hasn't attached media
   * return an empty array. */
  screenshots: string[];
  /** See {@link PluginOrigin}. Optional only so an older backend that predates
   * #402 (no `origin` at all) still type-checks; the source badge shows nothing
   * when it's absent rather than guessing. */
  origin?: PluginOrigin;
}

export interface CatalogPluginListResponse {
  plugins: CatalogPlugin[];
  count: number;
  total: number;
  limit: number;
  offset: number;
}

/** How plugin-registry installed a plugin (#2219, its `InstallSource`):
 * `vendored` (a code plugin shipped in its plugins directory), `git`
 * (install-from-git, or last refreshed from git) or `manifest` (a manifest
 * upload). `mindhub` is reserved server-side and not emitted yet. Typed open
 * so a value this client doesn't know yet still type-checks (it gets no
 * badge). */
export type InstallSource = "vendored" | "git" | "manifest" | (string & {});

/** One plugin plugin-registry has loaded on this installation (`GET /v1/plugins`,
 * its `PluginInfo` model). This is what actually runs, independent of any
 * per-user marketplace installation record. Not `license_key_masked` /
 * `updated_at`: those belong to the license-update response
 * (`PluginLicenseUpdateResponse`), and the list's `response_model` drops
 * anything not on `PluginInfo`.
 *
 * The four #2219 fields are optional because a registry older than #2219
 * omits them entirely. Absent (the key isn't there) and null (the backend
 * says "none") mean different things -- see {@link hasBackendField}. */
export interface RuntimePlugin {
  name: string;
  version: string;
  description: string;
  author: string;
  /** registered | enabled | disabled | error */
  status: string;
  enabled: boolean;
  dependencies: string[];
  capabilities: string[];
  data_sources: string[];
  databases: string[];
  registered_at: string;
  /** "unknown" until plugin-registry has run a health check. */
  health_status: string;
  last_health_check: string | null;
  /** How it was installed; null only for a row the registry hasn't classified
   * yet (backfilled on its next boot). */
  install_source?: InstallSource | null;
  /** The source repository of a `git` install, without credentials; null for
   * every other install source. */
  repository_url?: string | null;
  /** The marketplace catalog row this plugin is linked to -- the join key to
   * the catalog and to installation records (never the name). Null when it
   * has no catalog row: git and manifest installs, or a code plugin whose
   * catalog sync hasn't resolved. */
  marketplace_plugin_id?: string | null;
  /** Whether `GET /v1/plugins/{name}/config` has fields to edit. The same
   * predicate the config endpoint uses, so the two never disagree. */
  configurable?: boolean;
}

/** Whether `obj` carries `key` at all -- the way to tell a backend that
 * predates a field (key absent) from one that sends it as null. FastAPI
 * serialises every declared field, nulls included, so an absent key reliably
 * means an older deploy. */
export function hasBackendField<T extends object>(
  obj: T | null | undefined,
  key: keyof T,
): boolean {
  return obj != null && Object.prototype.hasOwnProperty.call(obj, key);
}

export interface RuntimePluginListResponse {
  plugins: RuntimePlugin[];
  count: number;
  total: number;
  limit: number;
  offset: number;
}

export interface MyInstallationsResponse {
  installations: Installation[];
  count: number;
}

interface ListPage<T> {
  items: T[];
  total: number | undefined;
}

/** A whole list fetched across pages. `truncated` is true when the page cap
 * stopped the walk while the server still had more, so the list is known to be
 * incomplete and callers must not treat "missing" as "absent". */
export interface PagedList<T> {
  items: T[];
  truncated: boolean;
}

/** Walks a limit/offset list endpoint to the end. Stops on the reported
 * `total`, on a short/empty page (so a response without `total` can't loop),
 * or after `maxPages` as a hard backstop. Hitting the backstop isn't silent: it
 * logs a console warning and reports `truncated` so the UI can say so. */
async function fetchAllPages<T>(
  label: string,
  fetchPage: (offset: number) => Promise<ListPage<T>>,
  pageSize: number,
  maxPages: number,
): Promise<PagedList<T>> {
  const all: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const { items, total } = await fetchPage(all.length);
    all.push(...items);
    if (items.length < pageSize) return { items: all, truncated: false };
    if (total !== undefined && all.length >= total) return { items: all, truncated: false };
  }
  console.warn(
    `${label}: stopped after ${maxPages} pages (${all.length} items); the list is incomplete.`,
  );
  return { items: all, truncated: true };
}

/** plugin-registry's `/v1/plugins` caps `limit` at 500. */
export const RUNTIME_PAGE_SIZE = 500;
/** The marketplace catalog caps `limit` at 100. */
export const CATALOG_PAGE_SIZE = 100;
/** Backstop on how many pages one list fetch may walk. */
export const MAX_PAGES = 20;

/** Every plugin plugin-registry has loaded on this installation, across all
 * pages. A response missing `plugins` is treated as empty, not a crash. */
export function fetchRuntimePlugins(
  token: string,
  signal?: AbortSignal,
): Promise<PagedList<RuntimePlugin>> {
  return fetchAllPages(
    "Runtime plugin list",
    async (offset) => {
      const res = await apiFetch<Partial<RuntimePluginListResponse>>(
        `/v1/plugins?limit=${RUNTIME_PAGE_SIZE}&offset=${offset}`,
        { token, signal },
      );
      return { items: res?.plugins ?? [], total: res?.total };
    },
    RUNTIME_PAGE_SIZE,
    MAX_PAGES,
  );
}

/** Whether `e` is plugin-registry's 404 "Plugin 'x' is not running" from a
 * per-plugin endpoint such as `GET /v1/plugins/{name}/config`. It means the
 * plugin has no loaded in-process instance to ask: manifest/webhook plugins
 * (uploaded or installed from git) never have one, and neither does a plugin
 * that isn't loaded. That's "no settings here", not a failure. Matched on
 * status + message, so any other 404 (e.g. a gateway route miss) stays an
 * error. Duck-typed rather than `instanceof ApiError` so it works on any
 * error carrying a `status`. */
export function isPluginNotRunningError(e: unknown): boolean {
  return (
    e instanceof Error &&
    (e as Error & { status?: unknown }).status === 404 &&
    /\bis not running\b/.test(e.message)
  );
}

/** The caller's own marketplace installation records (per-user). */
export async function fetchMyInstallations(
  token: string,
  signal?: AbortSignal,
): Promise<Installation[]> {
  const res = await apiFetch<Partial<MyInstallationsResponse>>(
    "/v1/marketplace/installations/me",
    { token, signal },
  );
  return res?.installations ?? [];
}

/** The whole public (approved) marketplace catalog, across all pages. The
 * Installed view only needs it against an older backend (before #2219), whose
 * runtime list and installation records don't say where a plugin came from;
 * see `needsCatalogFallback` in installedPlugins.ts. */
export function fetchCatalogPlugins(
  token: string,
  signal?: AbortSignal,
): Promise<PagedList<CatalogPlugin>> {
  return fetchAllPages(
    "Marketplace catalog",
    async (offset) => {
      const res = await apiFetch<Partial<CatalogPluginListResponse>>(
        `/v1/marketplace/plugins?limit=${CATALOG_PAGE_SIZE}&offset=${offset}`,
        { token, signal },
      );
      return { items: res?.plugins ?? [], total: res?.total };
    },
    CATALOG_PAGE_SIZE,
    MAX_PAGES,
  );
}
