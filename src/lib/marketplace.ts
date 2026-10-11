// The one typed module for every marketplace, plugin-registry and licensing
// call this client makes (#119): catalog, featured, search, the plugin graph
// (dependencies, conflicts, recommendations), installations and the
// install/enable/disable/uninstall lifecycle, runtime plugins and their
// config, Tools, submissions and review, plugin source repositories, ratings
// and licenses. Pages import these functions; none of them builds one of these
// `/v1/...` paths itself.
//
// Types come from the gateway spec (`api-types.gen.ts`) wherever it has a
// schema. Two adjustments are made on top, both documented where they apply:
//  - {@link ServerDefaulted}: the spec exports response models in validation
//    mode. The generator already makes a field with a non-null default
//    required, but one whose default is null or a factory (the list fields)
//    still comes out optional, although the API always serialises it. Those
//    fields are made required again.
//  - Open unions (`PluginOrigin`, `InstallSource`): the spec has closed enums
//    (or a plain string), but a newer backend may send a value this client
//    doesn't know yet, and that must still type-check.
// Where the spec has no usable schema (an untyped dict or array, or no request
// body at all) the shape is hand-written below and marked "Not in the spec".
// Fields are documented as the backend returns them; nothing here is
// synthesized client-side.

import { apiFetch } from "./api";
import type { components } from "./api-types.gen";
import type { ReviewerAction, ReviewQueueResponse } from "./submissionReview";

type Schemas = components["schemas"];

/** `T` with the keys `K` required and `undefined` removed from them. For
 * response fields whose server-side default is null or a factory: the
 * generated type marks them optional, but the API always sends them. */
type ServerDefaulted<T, K extends keyof T> = Omit<T, K> & {
  [P in K]-?: Exclude<T[P], undefined>;
};

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

/** Who put a catalog row on this installation: `first_party` rows are synced by
 * plugin-registry from the vendored plugin catalog (auto-approved), `submitted`
 * rows went through the developer submission + review flow. Typed open
 * (`string & {}`) because the column is a free-form string server-side. */
export type PluginOrigin = Schemas["PluginOrigin"] | (string & {});

/** A catalog row's lifecycle state: the marketplace's full `PluginStatus`
 * enum. The submission flow is draft → submitted → in_review → approved or
 * rejected, and archived delists a plugin. `approved` is the publicly visible
 * state; `pending` is the legacy value, kept for back-compat. */
export type PluginStatus = Schemas["PluginStatus"];

/** How plugin-registry installed a plugin (its `InstallSource`): `vendored` (a
 * code plugin shipped in its plugins directory), `git` (install-from-git, or
 * last refreshed from git) or `manifest` (a manifest upload). Typed open so a
 * value this client doesn't know yet still type-checks (it gets no badge). */
export type InstallSource = Schemas["InstallSource"] | (string & {});

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

/** One marketplace catalog row (`PluginResponse`): `GET /v1/marketplace/plugins`
 * and its search, featured and per-repository variants. `screenshots` is the
 * listing's media gallery (an empty array when the author attached none).
 * `origin` stays optional so an older backend that predates it still
 * type-checks; the source badge shows nothing when it's absent rather than
 * guessing. */
export type CatalogPlugin = ServerDefaulted<
  Omit<Schemas["PluginResponse"], "origin">,
  "requires_services" | "screenshots" | "rating_average" | "developer_id" | "category_id"
> & {
  /** See {@link PluginOrigin}. */
  origin?: PluginOrigin;
};

/** A page of catalog rows (`MarketplacePluginListResponse`). `total` drives
 * the paging walks, so it's required here (server default). */
export type CatalogPluginListResponse = Omit<
  ServerDefaulted<Schemas["MarketplacePluginListResponse"], "total" | "limit" | "offset">,
  "plugins"
> & { plugins: CatalogPlugin[] };

/** Filters for one page of the browsable catalog. */
export interface CatalogPageQuery {
  /** Free-text search; when set, the search endpoint is used instead. */
  query?: string;
  /** Only honoured by the plain list endpoint: search has no such param. */
  pricingModel?: string;
  /** The catalog `origin` to filter on server-side, or null for all. */
  origin?: string | null;
  limit: number;
  offset: number;
}

/** One page of the public catalog: a text search when `query` is non-blank,
 * else the plain list (with `pricing_model`). `origin` is sent to both. */
export function fetchCatalogPage({
  query = "",
  pricingModel = "",
  origin = null,
  limit,
  offset,
}: CatalogPageQuery): Promise<CatalogPluginListResponse> {
  let path: string;
  const q = query.trim();
  if (q) {
    path = `/v1/marketplace/plugins/search?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`;
  } else {
    path = `/v1/marketplace/plugins?limit=${limit}&offset=${offset}`;
    if (pricingModel) path += `&pricing_model=${encodeURIComponent(pricingModel)}`;
  }
  if (origin) path += `&origin=${encodeURIComponent(origin)}`;
  return apiFetch<CatalogPluginListResponse>(path);
}

/** The curated featured plugins. Public: sent without a token. */
export function fetchFeaturedPlugins(limit = 6): Promise<CatalogPluginListResponse> {
  return apiFetch<CatalogPluginListResponse>(`/v1/marketplace/plugins/featured?limit=${limit}`);
}

/** A quick catalog text search (the command palette). Public: no token. */
export function searchCatalogPlugins(
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<CatalogPluginListResponse> {
  return apiFetch<CatalogPluginListResponse>(
    `/v1/marketplace/plugins/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    { signal },
  );
}

// ---------------------------------------------------------------------------
// Plugin graph (dependencies, conflicts, recommendations)
// ---------------------------------------------------------------------------

/** One entry of `GET /v1/graph/dependencies/{id}`. Not in the spec: its
 * `dependencies` items are an untyped object. */
export interface DependencyEntry {
  plugin_id: string;
  name: string;
  depth: number;
}

/** One entry of `GET /v1/graph/conflicts/{id}`. Not in the spec: its
 * `conflicts` items are an untyped object. */
export interface ConflictEntry {
  plugin_id: string;
  name: string;
  reason: string;
}

/** One entry of `POST /v1/graph/recommendations`. Not in the spec: its
 * `recommendations` items are an untyped object. */
export interface Recommendation {
  plugin_id: string;
  name: string;
  score: number;
}

export type PluginDependenciesResponse = Omit<
  Schemas["PluginDependenciesResponse"],
  "dependencies"
> & { dependencies: DependencyEntry[] };

export type PluginConflictsResponse = Omit<Schemas["PluginConflictsResponse"], "conflicts"> & {
  conflicts: ConflictEntry[];
};

export type PluginRecommendationsResponse = Omit<
  Schemas["PluginRecommendationsResponse"],
  "recommendations"
> & { recommendations: Recommendation[] };

/** What a plugin depends on (transitively). Public: no token. */
export function fetchPluginDependencies(pluginId: string): Promise<PluginDependenciesResponse> {
  return apiFetch<PluginDependenciesResponse>(`/v1/graph/dependencies/${pluginId}`);
}

/** Which plugins conflict with this one. Public: no token. */
export function fetchPluginConflicts(pluginId: string): Promise<PluginConflictsResponse> {
  return apiFetch<PluginConflictsResponse>(`/v1/graph/conflicts/${pluginId}`);
}

/** Plugins recommended for the given installed catalog ids. */
export function fetchRecommendations(
  installedPluginIds: string[],
  token: string,
  limit = 5,
): Promise<PluginRecommendationsResponse> {
  return apiFetch<PluginRecommendationsResponse>(`/v1/graph/recommendations?limit=${limit}`, {
    method: "POST",
    body: installedPluginIds,
    token,
  });
}

// ---------------------------------------------------------------------------
// Installations and the plugin lifecycle
// ---------------------------------------------------------------------------

/** One of the caller's own marketplace installation records
 * (`InstalledPluginSummary`, `GET /v1/marketplace/installations/me`).
 * `status` stays a plain string so a status this client doesn't know still
 * type-checks. `origin` and `repository_url` are absent on an older
 * marketplace, which is why they're optional. */
export type Installation = ServerDefaulted<
  Omit<Schemas["InstalledPluginSummary"], "status" | "origin">,
  "requires_services"
> & {
  status: string;
  /** The installed plugin's catalog origin. */
  origin?: PluginOrigin;
};

export type MyInstallationsResponse = Omit<Schemas["MyInstallationsResponse"], "installations"> & {
  installations: Installation[];
};

/** The caller's own marketplace installation records (per-user). A response
 * missing `installations` is treated as empty, not a crash. */
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

/** Installs a catalog plugin for the caller. */
export function installPlugin(
  pluginId: string,
  token: string,
): Promise<Schemas["InstallationResponse"]> {
  return apiFetch<Schemas["InstallationResponse"]>(`/v1/marketplace/plugins/${pluginId}/install`, {
    method: "POST",
    token,
  });
}

/** Uninstalls the caller's installation of a catalog plugin. */
export function uninstallPlugin(
  pluginId: string,
  token: string,
): Promise<Schemas["PluginStateChangeResponse"]> {
  return apiFetch<Schemas["PluginStateChangeResponse"]>(
    `/v1/marketplace/plugins/${pluginId}/uninstall`,
    { method: "DELETE", token },
  );
}

/** Enables or disables the caller's installation of a catalog plugin. */
export function setPluginEnabled(
  pluginId: string,
  nextEnabled: boolean,
  token: string,
): Promise<Schemas["PluginEnableResponse"] | Schemas["PluginStateChangeResponse"]> {
  return apiFetch<Schemas["PluginEnableResponse"] | Schemas["PluginStateChangeResponse"]>(
    `/v1/marketplace/plugins/${pluginId}/${nextEnabled ? "enable" : "disable"}`,
    { method: "POST", token },
  );
}

// ---------------------------------------------------------------------------
// Runtime plugins (plugin-registry)
// ---------------------------------------------------------------------------

/** One plugin plugin-registry has loaded on this installation (`GET /v1/plugins`,
 * its `PluginInfo` model). This is what actually runs, independent of any
 * per-user marketplace installation record.
 *
 * `install_source`, `repository_url`, `marketplace_plugin_id` and
 * `configurable` stay optional because an older registry omits them entirely.
 * Absent (the key isn't there) and null (the backend says "none") mean
 * different things -- see {@link hasBackendField}. `install_source` is null
 * only for a row the registry hasn't classified yet; `repository_url` is the
 * source repository of a `git` install, without credentials;
 * `marketplace_plugin_id` is the catalog row this plugin is linked to (the
 * join key to the catalog and to installation records, never the name);
 * `configurable` uses the same predicate as `GET /v1/plugins/{name}/config`. */
export type RuntimePlugin = ServerDefaulted<
  Omit<Schemas["PluginInfo"], "install_source" | "configurable">,
  "last_health_check"
> & {
  /** See {@link InstallSource}. */
  install_source?: InstallSource | null;
  /** Optional although the spec requires it: an older registry omits it. */
  configurable?: boolean;
};

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

export type RuntimePluginListResponse = Omit<
  Schemas["PluginRegistryPluginListResponse"],
  "plugins"
> & { plugins: RuntimePlugin[] };

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

/** The whole public (approved) marketplace catalog, across all pages. The
 * Installed view only needs it against an older backend, whose runtime list
 * and installation records don't say where a plugin came from; see
 * `needsCatalogFallback` in installedPlugins.ts. */
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

/** The body of `POST /v1/plugins/install-from-git`. Not in the spec: the
 * route reads its body without a request model. Only `repo_url` is required;
 * `token` is a private-repo token, sent for this one fetch only. */
export interface InstallFromGitRequest {
  repo_url: string;
  ref?: string;
  subpath?: string;
  token?: string;
}

export type PluginInstallResponse = Schemas["PluginInstallResponse"];

/** Admin only: fetches and validates a plugin manifest from a git repository
 * and registers it as a manifest/webhook plugin (no repository code runs
 * in-process). */
export function installPluginFromGit(
  body: InstallFromGitRequest,
  token: string,
): Promise<PluginInstallResponse> {
  return apiFetch<PluginInstallResponse>("/v1/plugins/install-from-git", {
    method: "POST",
    body,
    token,
  });
}

// ---------------------------------------------------------------------------
// Runtime plugin config (plugin-registry)
// ---------------------------------------------------------------------------

/** One flat config field. Not in the spec: `PluginConfigResponse.schema` is
 * an untyped array. The presentation hints (SDK plugin-driven UI) are all
 * optional with safe fallbacks. */
export interface ConfigField {
  key: string;
  type?: "string" | "int" | "float" | "bool";
  secret?: boolean;
  description?: string;
  widget?: string;
  options?: { value: unknown; label: string }[];
  options_action?: string;
  rows?: number;
  placeholder?: string;
  group?: string;
}

/** A plugin's branding. Not in the spec: `display` is an untyped object. */
export interface PluginDisplay {
  label?: string;
  summary?: string;
  logo?: string;
  color?: string;
  category?: string;
}

/** What a plugin needs from the platform. */
export type PluginRequires = Schemas["PluginRequires"];

/** Not in the spec: `json_schema` is an untyped object. */
export interface JsonSchemaProperty {
  type?: string;
  enum?: unknown[];
  description?: string;
}

/** Not in the spec: `json_schema` is an untyped object. */
export interface JsonSchema {
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

/** Not in the spec: `ui_schema` is an untyped object. */
export type UiSchema = Record<
  string,
  { "ui:widget"?: string; "ui:placeholder"?: string; "ui:rows"?: number }
>;

/** `GET /v1/plugins/{name}/config`. Hand-written over the spec's
 * `PluginConfigResponse` because its `schema`, `display`, `json_schema` and
 * `ui_schema` are untyped. `display`, `requires`, `capabilities` and the
 * json/ui schemas stay optional, so an older registry that predates them
 * still renders. `json_schema` is the scalable form for plugins with no flat
 * `schema` (nested/enum/conditional shapes that don't fit ConfigField). */
export interface PluginConfigResponse {
  configurable: boolean;
  schema: ConfigField[];
  values: Record<string, unknown>;
  display?: PluginDisplay | null;
  requires?: PluginRequires | null;
  capabilities?: string[];
  json_schema?: JsonSchema | null;
  ui_schema?: UiSchema | null;
}

/** A running plugin's config schema and current values. */
export function fetchPluginConfig(name: string, token: string): Promise<PluginConfigResponse> {
  return apiFetch<PluginConfigResponse>(`/v1/plugins/${encodeURIComponent(name)}/config`, {
    token,
  });
}

/** Saves config values. Not in the spec: the route reads its body without a
 * request model, so the body is the field → value map. */
export function updatePluginConfig(
  name: string,
  values: Record<string, unknown>,
  token: string,
): Promise<Schemas["PluginConfigUpdateResponse"]> {
  return apiFetch<Schemas["PluginConfigUpdateResponse"]>(
    `/v1/plugins/${encodeURIComponent(name)}/config`,
    { method: "PUT", body: values, token },
  );
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/** One row of the durable Tools catalog (`AIToolItem`), whether or not the
 * plugin providing it is running right now. */
export type CatalogTool = Schemas["AIToolItem"];
export type CatalogToolsResponse = Schemas["AIToolListResponse"];

/** One page of the Tools catalog, inactive tools included. Public: no token. */
export function fetchCatalogToolsPage(
  offset: number,
  limit = 20,
): Promise<CatalogToolsResponse> {
  return apiFetch<CatalogToolsResponse>(
    `/v1/marketplace/ai/tools?active_only=false&limit=${limit}&offset=${offset}`,
  );
}

/** One Tool callable right now, in the function-calling shape the assistant
 * uses. Not in the spec: `AIToolsResponse.tools` items are untyped objects. */
export interface LiveTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type?: string;
      properties?: Record<string, { type?: string }>;
      required?: string[];
    };
  };
  metadata: {
    plugin: string;
    endpoint: string;
    method: string;
  };
}

export interface LiveToolsResponse {
  tools: LiveTool[];
}

/** The Tools callable right now, computed fresh from the running plugins. A
 * response missing `tools` is treated as empty, not a crash. Public: no
 * token. */
export function fetchLiveTools(signal?: AbortSignal): Promise<LiveTool[]> {
  return apiFetch<LiveToolsResponse>("/v1/plugins/ai/tools", { signal }).then(
    (r) => r.tools ?? [],
  );
}

// ---------------------------------------------------------------------------
// Submissions and review
// ---------------------------------------------------------------------------

/** One of the caller's own submissions (a `PluginResponse` row, the fields
 * the Submissions page reads). */
export type Submission = ServerDefaulted<
  Pick<
    Schemas["PluginResponse"],
    | "id"
    | "name"
    | "display_name"
    | "description"
    | "author"
    | "repository_url"
    | "distribution_type"
    | "docker_image"
    | "pricing_model"
    | "base_tier"
    | "status"
    | "review_notes"
    | "requires_services"
  >,
  "review_notes" | "requires_services"
>;

export type SubmissionListResponse = Omit<
  Schemas["MarketplacePluginListResponse"],
  "plugins"
> & { plugins: Submission[] };

/** `PluginCreate`. The generator also makes request fields that have a
 * server-side default (`distribution_type`, `pricing_model`, `base_tier`)
 * required, so the client always sends them; the form does anyway. */
export type SubmissionCreateRequest = Schemas["PluginCreate"];
export type SubmissionUpdateRequest = Schemas["PluginUpdate"];

/** The caller's own submissions, any status. */
export function fetchMySubmissions(
  token: string,
  signal?: AbortSignal,
): Promise<SubmissionListResponse> {
  return apiFetch<SubmissionListResponse>("/v1/marketplace/submissions/mine", {
    token,
    signal,
  });
}

/** Creates a draft submission. */
export function createSubmission(
  body: SubmissionCreateRequest,
  token: string,
): Promise<Schemas["PluginResponse"]> {
  return apiFetch<Schemas["PluginResponse"]>("/v1/marketplace/plugins", {
    method: "POST",
    token,
    body,
  });
}

/** Edits a submission's owner-editable fields. */
export function updateSubmission(
  pluginId: string,
  body: SubmissionUpdateRequest,
  token: string,
): Promise<Schemas["PluginResponse"]> {
  return apiFetch<Schemas["PluginResponse"]>(`/v1/marketplace/plugins/${pluginId}`, {
    method: "PUT",
    token,
    body,
  });
}

/** Moves the caller's draft (or rejected) submission into the review queue. */
export function submitForReview(
  pluginId: string,
  token: string,
): Promise<Schemas["PluginResponse"]> {
  return apiFetch<Schemas["PluginResponse"]>(`/v1/marketplace/submissions/${pluginId}/submit`, {
    method: "POST",
    token,
  });
}

/** Admin only: one page of the review queue for a status. */
export function fetchReviewQueue(
  status: string,
  limit: number,
  token: string,
  signal?: AbortSignal,
): Promise<ReviewQueueResponse> {
  return apiFetch<ReviewQueueResponse>(
    `/v1/marketplace/submissions?status=${encodeURIComponent(status)}&limit=${limit}`,
    { token, signal },
  );
}

/** The body of a reviewer transition: the notes of a reject. */
export type ReviewActionRequest = Schemas["ReviewActionRequest"];

/** Admin only: runs one reviewer transition. */
export function runReviewerAction(
  pluginId: string,
  action: ReviewerAction,
  token: string,
  body?: ReviewActionRequest,
): Promise<Schemas["PluginResponse"]> {
  return apiFetch<Schemas["PluginResponse"]>(
    `/v1/marketplace/submissions/${encodeURIComponent(pluginId)}/${action}`,
    { method: "POST", token, body },
  );
}

// ---------------------------------------------------------------------------
// Plugin source repositories
// ---------------------------------------------------------------------------

/** A plugin source repository (`PluginRepositoryResponse`):
 * `GET /v1/marketplace/repositories(/{id})`. */
export type PluginSourceRepository = ServerDefaulted<
  Schemas["PluginRepositoryResponse"],
  "description" | "source_url" | "owner" | "plugin_count"
>;

export type PluginSourceRepositoryListResponse = Omit<
  ServerDefaulted<Schemas["PluginRepositoryListResponse"], "total" | "limit" | "offset">,
  "repositories"
> & { repositories: PluginSourceRepository[] };

/** One page of source repositories. Public: no token. */
export function fetchSourceRepositoriesPage(
  offset: number,
  limit = 20,
): Promise<PluginSourceRepositoryListResponse> {
  return apiFetch<PluginSourceRepositoryListResponse>(
    `/v1/marketplace/repositories?limit=${limit}&offset=${offset}`,
  );
}

/** One source repository. Public: no token. */
export function fetchSourceRepository(
  repositoryId: string,
  signal?: AbortSignal,
): Promise<PluginSourceRepository> {
  return apiFetch<PluginSourceRepository>(`/v1/marketplace/repositories/${repositoryId}`, {
    signal,
  });
}

/** One page of the catalog plugins a source repository contributed. Public:
 * no token. */
export function fetchSourceRepositoryPluginsPage(
  repositoryId: string,
  offset: number,
  limit = 20,
): Promise<CatalogPluginListResponse> {
  return apiFetch<CatalogPluginListResponse>(
    `/v1/marketplace/repositories/${repositoryId}/plugins?limit=${limit}&offset=${offset}`,
  );
}

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

/** One user's rating/review row. `user_id` is the reviewer's stringified id,
 * matched against the caller's JWT `sub` to find "your" review. */
export type PluginRating = Schemas["RatingResponse"];

/** The live aggregate plus the individual reviews (newest first). */
export type PluginRatingsResponse = Schemas["PluginRatingsResponse"];

/** A plugin's ratings. Public: no token. */
export function fetchPluginRatings(pluginId: string): Promise<PluginRatingsResponse> {
  return apiFetch<PluginRatingsResponse>(`/v1/marketplace/plugins/${pluginId}/ratings`);
}

/** Creates or replaces the caller's rating. The reviewer is derived from the
 * JWT server-side: no user id is ever sent. */
export function submitPluginRating(
  pluginId: string,
  body: Schemas["RatingCreate"],
  token: string,
): Promise<PluginRating> {
  return apiFetch<PluginRating>(`/v1/marketplace/plugins/${pluginId}/ratings`, {
    method: "POST",
    body,
    token,
  });
}

// ---------------------------------------------------------------------------
// Licenses
// ---------------------------------------------------------------------------

/** One of the caller's plugin licenses (`TenantLicense`, the fields the
 * licenses page reads). */
export type License = Pick<
  Schemas["TenantLicense"],
  | "id"
  | "plugin_id"
  | "plugin_name"
  | "plugin_display_name"
  | "tier"
  | "valid_from"
  | "valid_until"
  | "active"
  | "usage_count"
  | "last_used_at"
>;

export type LicenseListResponse = Schemas["LicenseListResponse"];

/** The licenses held by the caller's tenant. */
export function fetchMyLicenses(token: string, signal?: AbortSignal): Promise<LicenseListResponse> {
  return apiFetch<LicenseListResponse>("/v1/marketplace/licenses", { token, signal });
}
