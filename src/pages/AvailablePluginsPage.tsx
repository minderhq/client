import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { CardListSkeleton } from "../components/CardListSkeleton";
import { Icon } from "../components/Icon";
import { useConfirm } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { LoadError } from "../components/LoadError";
import { PageHeader } from "../components/PageHeader";
import { PluginRatings } from "../components/PluginRatings";
import { ListedVersion } from "../components/PluginVersion";
import { SourceBadge, SourceLegend } from "../components/SourceBadge";
import { StatusBadge } from "../components/StatusBadge";
import { StatusLine } from "../components/StatusLine";
import { apiFetch, friendlyErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useAutoClearTimeout } from "../lib/browser";
import type {
  CatalogPlugin,
  CatalogPluginListResponse,
  MyInstallationsResponse,
} from "../lib/marketplace";
import {
  matchesSourceFilter,
  parseSourceFilter,
  resolveSource,
  SOURCE_FILTER_KINDS,
  SOURCE_META,
  SOURCE_PARAM,
  type SourceKind,
} from "../lib/pluginSource";
import type { Installation } from "../lib/types";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { usePaginatedList } from "../lib/usePaginatedList";
import { usePluginLifecycle } from "../lib/usePluginLifecycle";
import {
  badgeClass,
  cardClass,
  destructiveButtonClass,
  fieldHintClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../lib/ui";
import { useTokenRef } from "../lib/useTokenRef";
import { ROUTES } from "../lib/routes";

/** A marketplace catalog row. The shape lives in lib/marketplace.ts (#2198);
 * re-exported under its historical name for existing importers. */
export type Plugin = CatalogPlugin;

interface DependencyEntry {
  plugin_id: string;
  name: string;
  depth: number;
}

interface ConflictEntry {
  plugin_id: string;
  name: string;
  reason: string;
}

interface Recommendation {
  plugin_id: string;
  name: string;
  score: number;
}

function PricingBadge({ plugin }: { plugin: Plugin }) {
  return (
    <span className={badgeClass}>
      {plugin.pricing_model} · {plugin.base_tier}
    </span>
  );
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Source/distribution metadata the list already carries but the card never
 * rendered -- repository link, what actually ships (git/docker/hybrid), and
 * when it was published. */
function PluginMetaRow({
  plugin,
  installation,
}: {
  plugin: Plugin;
  installation: Installation | undefined;
}) {
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-gray-500 dark:text-gray-400">
      <ListedVersion listed={plugin.current_version} installed={installation?.version} />
      <span title={plugin.docker_image ?? undefined}>
        ships as {plugin.distribution_type}
      </span>
      {plugin.repository_url && (
        <a
          href={plugin.repository_url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-indigo-600 dark:hover:text-indigo-400"
        >
          Repository ↗
        </a>
      )}
      {plugin.published_at && <span>Published {formatShortDate(plugin.published_at)}</span>}
      {plugin.requires_services.length > 0 && (
        <span>Needs: {plugin.requires_services.join(", ")}</span>
      )}
    </p>
  );
}

/** Screenshot/media gallery (#1521): a simple horizontal strip of thumbnails a
 * plugin author has attached to the listing. Each thumbnail links to the full
 * image in a new tab. Renders nothing when the listing carries no screenshots,
 * so the card is unchanged for every existing plugin. `screenshots` may be
 * absent on responses served by a pre-#1521 backend, hence the `?? []` guard. */
function PluginScreenshotGallery({ plugin }: { plugin: Plugin }) {
  const screenshots = plugin.screenshots ?? [];
  if (screenshots.length === 0) return null;
  return (
    <div className="mt-2 flex gap-2 overflow-x-auto pb-1" aria-label="Screenshots">
      {screenshots.map((url, i) => (
        <a
          key={url}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0"
        >
          <img
            src={url}
            alt={`${plugin.display_name} screenshot ${i + 1}`}
            loading="lazy"
            className="h-24 w-auto rounded border border-gray-200 object-cover dark:border-gray-700"
          />
        </a>
      ))}
    </div>
  );
}

function DependencyPanel({ pluginId, pluginName }: { pluginId: string; pluginName: string }) {
  const [loaded, setLoaded] = useState(false);
  const [deps, setDeps] = useState<DependencyEntry[]>([]);
  const [conflicts, setConflicts] = useState<ConflictEntry[]>([]);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);

  async function handleToggle(e: React.SyntheticEvent<HTMLDetailsElement>) {
    if (!e.currentTarget.open || loaded) return;
    setStatus("Loading…");
    setIsError(false);
    try {
      const [depsRes, conflictsRes] = await Promise.all([
        apiFetch<{ dependencies: DependencyEntry[] }>(
          `/v1/graph/dependencies/${pluginId}`,
        ),
        apiFetch<{ conflicts: ConflictEntry[] }>(`/v1/graph/conflicts/${pluginId}`),
      ]);
      setDeps(depsRes.dependencies);
      setConflicts(conflictsRes.conflicts);
      setLoaded(true);
      setStatus("");
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    }
  }

  return (
    <details className="mt-2" onToggle={handleToggle}>
      <summary
        aria-label={`Dependencies & conflicts for ${pluginName}`}
        className="cursor-pointer text-xs font-medium text-indigo-600 dark:text-indigo-400"
      >
        Dependencies &amp; conflicts
      </summary>
      <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
        {status && <StatusLine isError={isError}>{status}</StatusLine>}
        {loaded && deps.length === 0 && conflicts.length === 0 && (
          <p>
            No dependency or conflict data recorded for this plugin yet — the
            dependency graph is built incrementally as plugins declare
            relationships to each other.
          </p>
        )}
        {deps.length > 0 && (
          <div className="mb-1">
            <strong>Depends on:</strong>{" "}
            {deps.map((d) => d.name).join(", ")}
          </div>
        )}
        {conflicts.length > 0 && (
          <div>
            <strong>Conflicts with:</strong>{" "}
            {conflicts.map((c) => `${c.name} (${c.reason})`).join(", ")}
          </div>
        )}
      </div>
    </details>
  );
}

/** Admin-only affordance turning a plugin's `repository_url` from a display-only
 * link into a real "install from this repo" action (#1579, epic #1514). It POSTs
 * to plugin-registry's `/v1/plugins/install-from-git` (reached through the
 * api-gateway proxy), which shallow-clones the repo, strictly validates ONLY the
 * plugin manifest, and registers it as a manifest/webhook plugin.
 *
 * TRUST MODEL (#1577): third-party plugins are manifest/webhook ONLY -- the
 * backend runs them OUT-OF-PROCESS over a webhook and NEVER imports or executes
 * fetched repo code in-process. The copy here is deliberate about that so the
 * button doesn't imply arbitrary code execution.
 *
 * Gated to admins because the endpoint is admin-only (`require_role("admin")`);
 * a non-admin call 403s, so we hide the affordance for non-admins (matching
 * nav.ts's admin-only convention) and, if one is somehow attempted, surface the
 * 403 via the shared error line rather than crashing. Optional ref/subpath and a
 * private-repo token are collected but never required -- repo_url alone is
 * enough. The token is a password field, cleared on success, and only ever sent
 * for the single fetch (the backend never logs or persists it). */
function InstallFromRepoPanel({
  repositoryUrl,
  pluginName,
  token,
}: {
  repositoryUrl: string;
  /** Completes the summary's and the button's accessible names, since every
   * card with a repository carries the same "Install from this repo". */
  pluginName: string;
  token: string;
}) {
  const [ref, setRef] = useState("");
  const [subpath, setSubpath] = useState("");
  const [pat, setPat] = useState("");
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus("Installing from repo…");
    setIsError(false);
    try {
      const body: Record<string, string> = { repo_url: repositoryUrl };
      if (ref.trim()) body.ref = ref.trim();
      if (subpath.trim()) body.subpath = subpath.trim();
      if (pat.trim()) body.token = pat.trim();
      const res = await apiFetch<{
        message: string;
        plugin: string;
        webhook_path: string | null;
      }>("/v1/plugins/install-from-git", { method: "POST", body, token });
      setPat(""); // never keep a private-repo token around after the one fetch
      setStatus(
        res.webhook_path
          ? `${res.message} (webhook: ${res.webhook_path})`
          : res.message,
      );
      setIsError(false);
    } catch (e) {
      // Surfaces the backend's own reason: SSRF-rejected URL, invalid manifest,
      // 409 already installed, or a 403 for a non-admin caller.
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    }
    setBusy(false);
  }

  return (
    <details className="mt-2">
      <summary
        aria-label={`Install from this repo: ${pluginName}`}
        className="cursor-pointer text-xs font-medium text-indigo-600 dark:text-indigo-400"
      >
        Install from this repo
      </summary>
      <form
        onSubmit={handleSubmit}
        className="mt-2 space-y-2 text-xs text-gray-600 dark:text-gray-400"
      >
        <p>
          Fetches and validates the plugin manifest from{" "}
          <span className="break-all font-mono">{repositoryUrl}</span> and
          registers it as a <strong>manifest/webhook</strong> plugin that runs
          out-of-process. No repository code is executed in-process.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span>Ref (optional)</span>
            <input
              className={inputClass}
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder="main"
              aria-label="Git ref"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>Subpath (optional)</span>
            <input
              className={inputClass}
              value={subpath}
              onChange={(e) => setSubpath(e.target.value)}
              placeholder="plugins/x"
              aria-label="Manifest subpath"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>Token (private repos)</span>
            <input
              className={inputClass}
              type="password"
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              autoComplete="off"
              aria-label="Access token"
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={busy}
          aria-label={`Install from this repo: ${pluginName}`}
          className={primaryButtonClass}
        >
          Install from this repo
        </button>
        {status && (
          <StatusLine isError={isError} className="mt-1">
            {status}
          </StatusLine>
        )}
      </form>
    </details>
  );
}

export function PluginCard({
  plugin,
  installation,
  token,
  isAuthenticated,
  isAdmin = false,
  onInstalled,
  onUninstalled,
  onToggleEnabled,
  confirm,
}: {
  plugin: Plugin;
  installation: Installation | undefined;
  token: string;
  isAuthenticated: boolean;
  /** Whether the caller is a platform admin. The install-from-git endpoint is
   * admin-only, so the affordance is hidden for everyone else (default). */
  isAdmin?: boolean;
  onInstalled: () => void;
  onUninstalled: (pluginId: string) => void;
  onToggleEnabled: (pluginId: string, enabled: boolean) => void;
  confirm: ReturnType<typeof useConfirm>["confirm"];
}) {
  const [justInstalled, setJustInstalled] = useState(false);
  const loginHintId = useId();
  const scheduleTimeout = useAutoClearTimeout();
  const { status, isError, busy, install, uninstall, toggleEnabled } = usePluginLifecycle({
    pluginId: plugin.id,
    displayName: plugin.display_name,
    token,
    confirm,
    onInstalled,
    onUninstalled,
    onToggleEnabled,
  });

  async function handleInstall() {
    if (await install()) {
      setJustInstalled(true);
      scheduleTimeout(() => setJustInstalled(false), 10000);
    }
  }

  async function handleUninstall() {
    await uninstall();
  }

  async function handleToggleEnabled() {
    if (!installation) return;
    await toggleEnabled(installation.enabled);
  }

  return (
    <section className={`mb-4 ${cardClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
            <Icon name="plugins" size={16} className="shrink-0 text-indigo-500 dark:text-indigo-400" /> {plugin.display_name}
          </h3>
          {plugin.description && (
            <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
              {plugin.description}
            </p>
          )}
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            by {plugin.author}
            {plugin.rating_count > 0 &&
              plugin.rating_average != null &&
              ` · ${plugin.rating_average.toFixed(1)}★ (${plugin.rating_count})`}
            {" · "}
            {plugin.download_count} install{plugin.download_count === 1 ? "" : "s"}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {plugin.featured && (
              <StatusBadge icon="star" label="Featured" tone="warn" />
            )}
            <SourceBadge source={resolveSource(plugin)} />
            <PricingBadge plugin={plugin} />
            {/* No category badge: the catalog only carries an opaque
                category_id and no endpoint resolves it to a name, so a badge
                could only show a raw UUID (#2195). */}
          </div>
          <PluginMetaRow plugin={plugin} installation={installation} />
          <PluginScreenshotGallery plugin={plugin} />
          {plugin.repository_url && isAdmin && (
            <InstallFromRepoPanel
              repositoryUrl={plugin.repository_url}
              pluginName={plugin.display_name}
              token={token}
            />
          )}
          <DependencyPanel pluginId={plugin.id} pluginName={plugin.display_name} />
          <PluginRatings
            pluginId={plugin.id}
            token={token}
            isAuthenticated={isAuthenticated}
            isInstalled={!!installation}
          />
        </div>
        <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
          {!installation ? (
            <button
              onClick={handleInstall}
              disabled={!isAuthenticated || busy}
              aria-label={`Install ${plugin.display_name}`}
              aria-describedby={!isAuthenticated ? loginHintId : undefined}
              className={primaryButtonClass}
            >
              Install
            </button>
          ) : (
            <>
              <button
                onClick={handleToggleEnabled}
                disabled={busy}
                aria-label={`${installation.enabled ? "Disable" : "Enable"} ${plugin.display_name}`}
                className={secondaryButtonClass}
              >
                {installation.enabled ? "Disable" : "Enable"}
              </button>
              <button
                onClick={handleUninstall}
                disabled={busy}
                aria-label={`Uninstall ${plugin.display_name}`}
                className={destructiveButtonClass}
              >
                <Icon name="delete" size={15} /> Uninstall
              </button>
              <StatusBadge
                icon={installation.enabled ? "check" : "close"}
                label={installation.enabled ? "Enabled" : "Disabled"}
                tone={installation.enabled ? "success" : "neutral"}
                srPrefix="Your install"
              />
            </>
          )}
          {!isAuthenticated && (
            <p id={loginHintId} className={`${fieldHintClass} text-right`}>
              Log in to install
            </p>
          )}
        </div>
      </div>
      {status && <StatusLine isError={isError} className="mt-2">{status}</StatusLine>}
      {justInstalled && (
        <p className="mt-2 rounded-lg bg-green-50 p-2 text-xs text-green-900 dark:bg-green-950 dark:text-green-100">
          <Icon name="check" size={13} className="mr-1 inline-block align-[-2px]" />
          Installed. If this plugin exposes an AI tool,{" "}
          <Link
            to={ROUTES.installedAiTools}
            className="underline hover:text-green-700 dark:hover:text-green-300"
          >
            check Installed AI tools
          </Link>{" "}
          to confirm it's live.
        </p>
      )}
    </section>
  );
}

// Pricing model is a fixed, known enum (models/plugin.py's `PricingModel`) --
// safe to hard-code here. There is deliberately no category filter: the
// catalog only carries an opaque category_id and the marketplace exposes no
// categories endpoint to name it, so the options could only be raw UUIDs
// (#2195; the filter #1519 wired returns once names can be resolved).
const PRICING_MODEL_OPTIONS = [
  { value: "", label: "All pricing" },
  { value: "free", label: "Free" },
  { value: "freemium", label: "Freemium" },
  { value: "paid", label: "Paid" },
];

function SearchAndFilters({
  query,
  onQueryChange,
  pricingModel,
  onPricingModelChange,
  source,
  onSourceChange,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  pricingModel: string;
  onPricingModelChange: (v: string) => void;
  source: SourceKind | null;
  onSourceChange: (v: SourceKind | null) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <input
        className={`${inputClass} max-w-xs`}
        type="text"
        aria-label="Search plugins"
        placeholder="Search plugins…"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      <select
        className={`${inputClass} w-auto`}
        aria-label="Filter by pricing"
        value={pricingModel}
        onChange={(e) => onPricingModelChange(e.target.value)}
      >
        {PRICING_MODEL_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {/* Source is a filter over the one catalog, not a separate store (epic
          #2192). Client-side over the loaded pages -- the catalog API has no
          source param -- and mirrored in ?source= so a filtered view is
          shareable. Options come from SOURCE_FILTER_KINDS, so MindHub joins
          by adding one entry there (Phase 2). */}
      <select
        className={`${inputClass} w-auto`}
        aria-label="Filter by source"
        value={source ? SOURCE_META[source].param : ""}
        onChange={(e) => onSourceChange(parseSourceFilter(e.target.value))}
      >
        <option value="">All sources</option>
        {SOURCE_FILTER_KINDS.map((kind) => (
          <option key={kind} value={SOURCE_META[kind].param}>
            {SOURCE_META[kind].filterLabel}
          </option>
        ))}
      </select>
    </div>
  );
}

/** "Recommended based on what you've installed", each name a link to that
 * plugin in Discover. There is no per-plugin route, so a recommendation opens
 * Discover searched for its name (`?q=`) -- the same deep link the ⌘K palette
 * uses (#1210). Unlike scrolling to a card, that works for a plugin that isn't
 * on the loaded page, survives a reload and can be shared. The search matches
 * on display name, which is what the recommendation carries. */
function Recommendations({ recommendations }: { recommendations: Recommendation[] }) {
  const labelId = useId();
  return (
    <div className="mb-6 text-xs text-gray-500 dark:text-gray-400">
      <span id={labelId}>Recommended based on what you've installed:</span>{" "}
      <ul aria-labelledby={labelId} className="inline">
        {recommendations.map((r, i) => (
          <li key={r.plugin_id} className="inline">
            <Link
              to={{ search: `?${new URLSearchParams({ q: r.name })}` }}
              className="font-medium text-indigo-600 underline hover:text-indigo-500 dark:text-indigo-400"
            >
              {r.name}
            </Link>
            {i < recommendations.length - 1 && ", "}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AvailablePluginsPage() {
  const { token, sessionKey, isAuthenticated, role } = useAuth();
  const tokenRef = useTokenRef();
  // The install-from-git endpoint is admin-only; gate the affordance to admins
  // the same way nav.ts hides admin-only destinations (the backend 403s others).
  const isAdmin = role === "admin";
  const { confirm, dialog } = useConfirm();
  // Seed from ?q= so the ⌘K palette can deep-link to a specific plugin (#1210).
  const [searchParams, setSearchParams] = useSearchParams();
  // The source filter lives in ?source= and is derived from the URL on every
  // render (not copied into state), so a shared link opens on the same filter.
  // Changes replace the history entry rather than pushing one per tweak.
  const source = parseSourceFilter(searchParams.get(SOURCE_PARAM));
  const setSource = useCallback(
    (next: SourceKind | null) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next) params.set(SOURCE_PARAM, SOURCE_META[next].param);
          else params.delete(SOURCE_PARAM);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  // The search box is local state (typing must never wait on navigation), and
  // mirrored into ?q= so the URL always says what's being searched. A ?q= that
  // arrives from elsewhere -- a recommendation link, the ⌘K palette while
  // already on this page -- is copied back into the box. `lastUrlQueryRef`
  // remembers what this page last wrote, so its own mirror never echoes back
  // over newer keystrokes.
  const urlQuery = searchParams.get("q") ?? "";
  const [queryInput, setQueryInput] = useState(urlQuery);
  const lastUrlQueryRef = useRef(urlQuery);
  useEffect(() => {
    if (urlQuery === lastUrlQueryRef.current) return;
    lastUrlQueryRef.current = urlQuery;
    setQueryInput(urlQuery);
  }, [urlQuery]);
  const handleQueryChange = useCallback(
    (next: string) => {
      setQueryInput(next);
      lastUrlQueryRef.current = next;
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next) params.set("q", next);
          else params.delete("q");
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const query = useDebouncedValue(queryInput, 300);
  const [pricingModel, setPricingModel] = useState("");
  const [myInstallations, setMyInstallations] = useState<Installation[]>([]);
  const [installationsError, setInstallationsError] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [recommendationsError, setRecommendationsError] = useState<string | null>(null);
  const [featured, setFeatured] = useState<Plugin[]>([]);
  const [featuredError, setFeaturedError] = useState<string | null>(null);

  // Featured, installations and recommendations are secondary to the catalog:
  // a failure shows a quiet notice with Retry (#2195) and never blocks the
  // main list -- the full catalog below still shows featured plugins (with a
  // badge), just not curated to the top.
  const loadFeatured = useCallback(async () => {
    setFeaturedError(null);
    try {
      const res = await apiFetch<CatalogPluginListResponse>("/v1/marketplace/plugins/featured?limit=6");
      setFeatured(res.plugins);
    } catch (e) {
      setFeaturedError(friendlyErrorMessage(e));
    }
  }, []);

  useEffect(() => {
    loadFeatured();
  }, [loadFeatured]);

  const fetchPluginsPage = useCallback(
    async (nextOffset: number) => {
      let path: string;
      if (query.trim()) {
        // /plugins/search has no pricing_model param of its own (search-by-text
        // only) -- the client-side filter on `visiblePlugins` below covers this
        // path; only the plain browse endpoint gets it as a real server-side
        // query param.
        path = `/v1/marketplace/plugins/search?q=${encodeURIComponent(query.trim())}&limit=20&offset=${nextOffset}`;
      } else {
        path = `/v1/marketplace/plugins?limit=20&offset=${nextOffset}`;
        if (pricingModel) path += `&pricing_model=${encodeURIComponent(pricingModel)}`;
      }
      const res = await apiFetch<CatalogPluginListResponse>(path);
      return { items: res.plugins, total: res.total };
    },
    [query, pricingModel],
  );
  const {
    items: plugins,
    loading: pluginsLoading,
    loaded: pluginsLoaded,
    error: pluginsError,
    errorOnMore: pluginsErrorOnMore,
    retry: retryPlugins,
    reload: reloadPlugins,
    loadMore: loadMorePlugins,
    hasMore: hasMorePlugins,
  } = usePaginatedList(fetchPluginsPage);

  const loadRecommendations = useCallback(
    async (installed: Installation[]) => {
      setRecommendationsError(null);
      if (installed.length === 0) {
        setRecommendations([]);
        return;
      }
      try {
        const rec = await apiFetch<{ recommendations: Recommendation[] }>(
          "/v1/graph/recommendations?limit=5",
          { method: "POST", body: installed.map((i) => i.plugin_id), token: tokenRef.current },
        );
        // `?? []`: a response missing `recommendations` would otherwise set
        // state to `undefined` (no throw happens) and crash later on
        // `recommendations.length` -- the same failure shape HealthStrip.tsx
        // hit for its own optional `services` key.
        setRecommendations(rec.recommendations ?? []);
      } catch (e) {
        setRecommendationsError(friendlyErrorMessage(e));
      }
    },
    [tokenRef],
  );

  const loadMyInstallations = useCallback(async () => {
    setInstallationsError(null);
    if (!isAuthenticated) {
      setMyInstallations([]);
      setRecommendations([]);
      setRecommendationsError(null);
      return;
    }
    try {
      const res = await apiFetch<MyInstallationsResponse>(
        "/v1/marketplace/installations/me",
        { token: tokenRef.current },
      );
      setMyInstallations(res.installations);
      await loadRecommendations(res.installations);
    } catch (e) {
      // Without the caller's installs, every card offers "Install" -- say so
      // rather than look like nothing is installed.
      setInstallationsError(friendlyErrorMessage(e));
    }
  }, [isAuthenticated, tokenRef, loadRecommendations]);

  useEffect(() => {
    // query changes trigger a fresh search from offset 0 (reloadPlugins'
    // identity changes with it, since it flows through fetchPluginsPage).
    reloadPlugins();
  }, [reloadPlugins]);

  useEffect(() => {
    loadMyInstallations();
  }, [loadMyInstallations, sessionKey]);

  const featuredIds = useMemo(() => new Set(featured.map((p) => p.id)), [featured]);
  // Featured is curated separately from the paginated catalog below, so the
  // same plugin can appear in both -- drop it from the catalog list once
  // it's already shown above. Search results skip this: a query is asking
  // "does this plugin match," not "browse the catalog," so hiding a
  // matching plugin because it happens to be Featured would look broken.
  const visiblePlugins = (query.trim()
    ? plugins
    : plugins.filter((plugin) => !featuredIds.has(plugin.id))
  ).filter(
    (plugin) =>
      // Redundant-but-harmless for the plain-browse path (the server already
      // filtered by pricing there) -- the ONLY path that actually needs this
      // is search (/plugins/search has no pricing_model param of its own),
      // so this filter has to apply uniformly to both rather than just the
      // search branch.
      (!pricingModel || plugin.pricing_model === pricingModel) &&
      matchesSourceFilter(resolveSource(plugin), source),
  );
  const visibleFeatured = featured.filter((plugin) =>
    matchesSourceFilter(resolveSource(plugin), source),
  );
  const filtersActive = !!(pricingModel || source);
  // A failed first page (or a failed new search/filter) leaves the previous
  // results in state; they no longer answer the current query, so the error
  // replaces the list. A failed Load more keeps what already loaded.
  const listFailed = !!pluginsError && !pluginsErrorOnMore;
  // Only a successful load can prove the catalog is empty: never while the
  // first page (or a new search) is in flight, and never after a failure.
  const showSkeleton = !pluginsLoaded && !pluginsError;
  const catalogEmpty =
    pluginsLoaded && !pluginsLoading && !pluginsError && plugins.length === 0;

  function installationFor(pluginId: string) {
    return myInstallations.find((i) => i.plugin_id === pluginId);
  }

  function handleUninstalled(pluginId: string) {
    setMyInstallations((prev) => prev.filter((i) => i.plugin_id !== pluginId));
  }

  function handleToggleEnabled(pluginId: string, enabled: boolean) {
    setMyInstallations((prev) =>
      prev.map((i) => (i.plugin_id === pluginId ? { ...i, enabled } : i)),
    );
  }

  return (
    <>
      {dialog}
      <PageHeader
        icon="available-plugins"
        title="Discover plugins"
        subtitle="Browse and install Minder plugins. Browsing is open for everyone; log in to install, enable, disable, or uninstall."
      />
      <StatusLine>{pluginsLoading ? "Loading plugins…" : ""}</StatusLine>

      {featuredError && !query.trim() && (
        <LoadError
          quiet
          title="Featured plugins couldn't be loaded — they still appear in the full list below."
          message={featuredError}
          what="featured plugins"
          onRetry={loadFeatured}
        />
      )}
      {visibleFeatured.length > 0 && !query.trim() && (
        <section className="mb-6" aria-labelledby="featured-heading">
          <h2
            id="featured-heading"
            className="mb-2 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100"
          >
            <Icon name="star" size={16} className="shrink-0 text-indigo-500 dark:text-indigo-400" />
            Featured
          </h2>
          {visibleFeatured.map((plugin) => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              installation={installationFor(plugin.id)}
              token={token}
              isAuthenticated={isAuthenticated}
              isAdmin={isAdmin}
              onInstalled={loadMyInstallations}
              onUninstalled={handleUninstalled}
              onToggleEnabled={handleToggleEnabled}
              confirm={confirm}
            />
          ))}
        </section>
      )}

      {isAuthenticated && installationsError && (
        <LoadError
          quiet
          title="Your installed plugins couldn't be loaded, so install state on these cards may be out of date."
          message={installationsError}
          what="your installed plugins"
          onRetry={loadMyInstallations}
        />
      )}
      {isAuthenticated && myInstallations.length > 0 && recommendationsError && (
        <LoadError
          quiet
          title="Recommendations couldn't be loaded."
          message={recommendationsError}
          what="recommendations"
          onRetry={() => loadRecommendations(myInstallations)}
        />
      )}
      {isAuthenticated && myInstallations.length > 0 && recommendations.length > 0 && (
        <Recommendations recommendations={recommendations} />
      )}
      {isAuthenticated && myInstallations.length > 0 && (
        <p className="mb-6 text-xs text-gray-500 dark:text-gray-400">
          You have {myInstallations.length} plugin{myInstallations.length === 1 ? "" : "s"}{" "}
          installed —{" "}
          <Link to={ROUTES.installedPlugins} className="underline hover:text-indigo-600 dark:hover:text-indigo-400">
            manage or configure them
          </Link>
          .
        </p>
      )}

      <section aria-labelledby="all-plugins-heading">
        <h2
          id="all-plugins-heading"
          className="mb-2 text-base font-semibold text-gray-900 dark:text-gray-100"
        >
          All plugins
        </h2>
        <SearchAndFilters
          query={queryInput}
          onQueryChange={handleQueryChange}
          pricingModel={pricingModel}
          onPricingModelChange={setPricingModel}
          source={source}
          onSourceChange={setSource}
        />
        <SourceLegend className="mb-4" />

        {showSkeleton && <CardListSkeleton count={3} />}
        {listFailed && (
          <LoadError
            title={
              query.trim()
                ? "Couldn't search the plugin catalog."
                : "Couldn't load the plugin catalog."
            }
            message={pluginsError}
            what={query.trim() ? "search results" : "the plugin catalog"}
            onRetry={retryPlugins}
          />
        )}
        {catalogEmpty && (
          <EmptyState>
            {query
              ? "No plugins match your search."
              : pricingModel
                ? "No plugins match the selected filters."
                : "No plugins in the catalog yet."}
          </EmptyState>
        )}
        {!listFailed && !pluginsLoading && plugins.length > 0 && visiblePlugins.length === 0 && (
          <EmptyState>
            {filtersActive
              ? "No plugins on this page match the selected filters."
              : "Every plugin on this page is already shown above in Featured."}
          </EmptyState>
        )}
        {!listFailed &&
          visiblePlugins.map((plugin) => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              installation={installationFor(plugin.id)}
              token={token}
              isAuthenticated={isAuthenticated}
              isAdmin={isAdmin}
              onInstalled={loadMyInstallations}
              onUninstalled={handleUninstalled}
              onToggleEnabled={handleToggleEnabled}
              confirm={confirm}
            />
          ))}
        {pluginsError && pluginsErrorOnMore && (
          <LoadError
            title="Couldn't load more plugins."
            message={pluginsError}
            what="more plugins"
            onRetry={retryPlugins}
          />
        )}
        {hasMorePlugins && !listFailed && !pluginsError && (
          <button onClick={loadMorePlugins} disabled={pluginsLoading} className={secondaryButtonClass}>
            Load more
          </button>
        )}
      </section>
    </>
  );
}
