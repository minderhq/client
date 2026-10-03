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
  status: "pending" | "approved" | "rejected" | "archived";
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

/** One plugin plugin-registry has loaded on this installation (`GET /v1/plugins`,
 * its `PluginInfo` model). This is what actually runs, independent of any
 * per-user marketplace installation record. Note what it does NOT carry: no
 * origin/source, no repository URL, no marketplace id and no "configurable"
 * flag -- callers join the catalog by `name` for the first two and fetch
 * `/v1/plugins/{name}/config` lazily for the last. */
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

/** The whole public (approved) marketplace catalog, across all pages -- used
 * to look up `origin`/`repository_url`/`current_version` for installed and
 * runtime-loaded plugins, which the installations and runtime payloads don't
 * carry themselves. */
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
