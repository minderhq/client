import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { Icon } from "../components/Icon";
import { useConfirm } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { StatusLine } from "../components/StatusLine";
import { apiFetch, friendlyErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useAutoClearTimeout } from "../lib/browser";
import type { Installation } from "../lib/types";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { usePaginatedList } from "../lib/usePaginatedList";
import { usePluginLifecycle } from "../lib/usePluginLifecycle";
import {
  badgeClass,
  cardClass,
  destructiveButtonClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../lib/ui";

export interface Plugin {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  author: string;
  repository_url: string | null;
  distribution_type: "git" | "docker" | "hybrid";
  docker_image: string | null;
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
}

interface PluginListResponse {
  plugins: Plugin[];
  count: number;
  total: number;
  limit: number;
  offset: number;
}

interface MyInstallationsResponse {
  installations: Installation[];
  count: number;
}

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
function PluginMetaRow({ plugin }: { plugin: Plugin }) {
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-gray-500 dark:text-gray-400">
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

function DependencyPanel({ pluginId }: { pluginId: string }) {
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
      <summary className="cursor-pointer text-xs font-medium text-indigo-600 dark:text-indigo-400">
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

export function PluginCard({
  plugin,
  installation,
  token,
  isAuthenticated,
  onInstalled,
  onUninstalled,
  onToggleEnabled,
  confirm,
}: {
  plugin: Plugin;
  installation: Installation | undefined;
  token: string;
  isAuthenticated: boolean;
  onInstalled: () => void;
  onUninstalled: (pluginId: string) => void;
  onToggleEnabled: (pluginId: string, enabled: boolean) => void;
  confirm: ReturnType<typeof useConfirm>["confirm"];
}) {
  const [justInstalled, setJustInstalled] = useState(false);
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
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
            <Icon name="plugins" size={16} className="shrink-0 text-indigo-500 dark:text-indigo-400" /> {plugin.display_name}
            {plugin.featured && <span className={badgeClass}>⭐ featured</span>}
          </h2>
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
            <PricingBadge plugin={plugin} />
            {plugin.category_id && (
              <span className={badgeClass}>{plugin.category_id}</span>
            )}
          </div>
          <PluginMetaRow plugin={plugin} />
          <DependencyPanel pluginId={plugin.id} />
        </div>
        <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
          {!installation ? (
            <button
              onClick={handleInstall}
              disabled={!isAuthenticated || busy}
              className={primaryButtonClass}
            >
              Install
            </button>
          ) : (
            <>
              <button
                onClick={handleToggleEnabled}
                disabled={busy}
                className={secondaryButtonClass}
              >
                {installation.enabled ? "Disable" : "Enable"}
              </button>
              <button
                onClick={handleUninstall}
                disabled={busy}
                className={destructiveButtonClass}
              >
                <Icon name="delete" size={15} /> Uninstall
              </button>
              <span className={badgeClass}>
                {installation.enabled ? "✓ enabled" : "disabled"}
              </span>
            </>
          )}
          {!isAuthenticated && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Log in to install
            </span>
          )}
        </div>
      </div>
      {status && <StatusLine isError={isError} className="mt-2">{status}</StatusLine>}
      {justInstalled && (
        <p className="mt-2 rounded-lg bg-green-50 p-2 text-xs text-green-900 dark:bg-green-950 dark:text-green-100">
          ✅ Installed. If this plugin exposes an AI tool,{" "}
          <Link
            to="/ai-tools/available"
            className="underline hover:text-green-700 dark:hover:text-green-300"
          >
            check AI Tools
          </Link>{" "}
          to confirm it's live.
        </p>
      )}
    </section>
  );
}

function SearchAndFilters({
  query,
  onQueryChange,
}: {
  query: string;
  onQueryChange: (q: string) => void;
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
    </div>
  );
}

export function AvailablePluginsPage() {
  const { token, isAuthenticated } = useAuth();
  const { confirm, dialog } = useConfirm();
  // Seed from ?q= so the ⌘K palette can deep-link to a specific plugin (#1210).
  const [searchParams] = useSearchParams();
  const [queryInput, setQueryInput] = useState(() => searchParams.get("q") ?? "");
  const query = useDebouncedValue(queryInput, 300);
  const [myInstallations, setMyInstallations] = useState<Installation[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [featured, setFeatured] = useState<Plugin[]>([]);

  const loadFeatured = useCallback(async () => {
    try {
      const res = await apiFetch<PluginListResponse>("/v1/marketplace/plugins/featured?limit=6");
      setFeatured(res.plugins);
    } catch {
      // best-effort -- the full catalog below still shows featured plugins
      // (with a badge), just not curated to the top
    }
  }, []);

  useEffect(() => {
    loadFeatured();
  }, [loadFeatured]);

  const fetchPluginsPage = useCallback(
    async (nextOffset: number) => {
      const path = query.trim()
        ? `/v1/marketplace/plugins/search?q=${encodeURIComponent(query.trim())}&limit=20&offset=${nextOffset}`
        : `/v1/marketplace/plugins?limit=20&offset=${nextOffset}`;
      const res = await apiFetch<PluginListResponse>(path);
      return { items: res.plugins, total: res.total };
    },
    [query],
  );
  const {
    items: plugins,
    status,
    isError: isStatusError,
    reload: reloadPlugins,
    loadMore: loadMorePlugins,
    hasMore: hasMorePlugins,
  } = usePaginatedList(fetchPluginsPage);

  const loadMyInstallations = useCallback(async () => {
    if (!isAuthenticated) {
      setMyInstallations([]);
      return;
    }
    try {
      const res = await apiFetch<MyInstallationsResponse>(
        "/v1/marketplace/installations/me",
        { token },
      );
      setMyInstallations(res.installations);
      if (res.installations.length > 0) {
        const ids = res.installations.map((i) => i.plugin_id);
        try {
          const rec = await apiFetch<{ recommendations: Recommendation[] }>(
            "/v1/graph/recommendations?limit=5",
            { method: "POST", body: ids, token },
          );
          // `?? []`: a response missing `recommendations` would otherwise set
          // state to `undefined`, past this try/catch (no throw happens) and
          // crashing later on `recommendations.length` -- the same failure
          // shape HealthStrip.tsx hit for its own optional `services` key.
          setRecommendations(rec.recommendations ?? []);
        } catch {
          // recommendations are a nice-to-have; ignore failures quietly
        }
      } else {
        setRecommendations([]);
      }
    } catch {
      // best-effort -- an install action will surface its own error
    }
  }, [isAuthenticated, token]);

  useEffect(() => {
    // query changes trigger a fresh search from offset 0 (reloadPlugins'
    // identity changes with it, since it flows through fetchPluginsPage).
    reloadPlugins();
  }, [reloadPlugins]);

  useEffect(() => {
    loadMyInstallations();
  }, [loadMyInstallations]);

  const featuredIds = useMemo(() => new Set(featured.map((p) => p.id)), [featured]);
  // Featured is curated separately from the paginated catalog below, so the
  // same plugin can appear in both -- drop it from the catalog list once
  // it's already shown above. Search results skip this: a query is asking
  // "does this plugin match," not "browse the catalog," so hiding a
  // matching plugin because it happens to be Featured would look broken.
  const visiblePlugins = query.trim()
    ? plugins
    : plugins.filter((plugin) => !featuredIds.has(plugin.id));

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
        title="Available Plugins"
        subtitle="Browse and install Minder plugins. Browsing is open for everyone; log in to install, enable, disable, or uninstall."
      />
      <StatusLine isError={isStatusError}>{status}</StatusLine>

      {featured.length > 0 && !query.trim() && (
        <section className="mb-6">
          <h2 className="mb-2 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
            <Icon name="star" size={16} className="shrink-0 text-indigo-500 dark:text-indigo-400" />
            Featured
          </h2>
          {featured.map((plugin) => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              installation={installationFor(plugin.id)}
              token={token}
              isAuthenticated={isAuthenticated}
              onInstalled={loadMyInstallations}
              onUninstalled={handleUninstalled}
              onToggleEnabled={handleToggleEnabled}
              confirm={confirm}
            />
          ))}
        </section>
      )}

      {isAuthenticated && myInstallations.length > 0 && recommendations.length > 0 && (
        <p className="mb-6 text-xs text-gray-500 dark:text-gray-400">
          Recommended based on what you've installed:{" "}
          {recommendations.map((r) => r.name).join(", ")}
        </p>
      )}
      {isAuthenticated && myInstallations.length > 0 && (
        <p className="mb-6 text-xs text-gray-500 dark:text-gray-400">
          You have {myInstallations.length} plugin{myInstallations.length === 1 ? "" : "s"}{" "}
          installed —{" "}
          <Link to="/plugins/installed" className="underline hover:text-indigo-600 dark:hover:text-indigo-400">
            manage or configure them
          </Link>
          .
        </p>
      )}

      <SearchAndFilters query={queryInput} onQueryChange={setQueryInput} />

      {plugins.length === 0 && (
        <EmptyState>
          {query
            ? "No plugins match your search."
            : "No plugins in the catalog yet."}
        </EmptyState>
      )}
      {plugins.length > 0 && visiblePlugins.length === 0 && (
        <EmptyState>
          Every plugin on this page is already shown above in Featured.
        </EmptyState>
      )}
      {visiblePlugins.map((plugin) => (
        <PluginCard
          key={plugin.id}
          plugin={plugin}
          installation={installationFor(plugin.id)}
          token={token}
          isAuthenticated={isAuthenticated}
          onInstalled={loadMyInstallations}
          onUninstalled={handleUninstalled}
          onToggleEnabled={handleToggleEnabled}
          confirm={confirm}
        />
      ))}
      {hasMorePlugins && (
        <button onClick={loadMorePlugins} className={secondaryButtonClass}>
          Load more
        </button>
      )}
    </>
  );
}
