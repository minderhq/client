import { useCallback, useEffect } from "react";
import { Link } from "react-router-dom";

import { Icon } from "../components/Icon";
import { EmptyState } from "../components/EmptyState";
import { InfoCallout } from "../components/InfoCallout";
import { PageHeader } from "../components/PageHeader";
import { StatusLine } from "../components/StatusLine";
import { apiFetch } from "../lib/api";
import { badgeClass, secondaryButtonClass } from "../lib/ui";
import { usePaginatedList } from "../lib/usePaginatedList";

interface CatalogTool {
  id: string;
  plugin_id: string;
  plugin_name: string;
  plugin_display_name: string;
  tool_name: string;
  type: string;
  description: string | null;
  endpoint: string;
  method: string;
  required_tier: string;
  active: boolean;
}

interface CatalogToolsResponse {
  tools: CatalogTool[];
  count: number;
  total: number;
  limit: number;
  offset: number;
}

function CatalogToolCard({ tool }: { tool: CatalogTool }) {
  return (
    <section className="mb-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
        <Icon name="ai-tools" size={16} className="shrink-0 text-indigo-500 dark:text-indigo-400" /> {tool.tool_name}
        <span className={badgeClass}>{tool.plugin_display_name}</span>
        <span className={badgeClass}>{tool.required_tier}</span>
        {!tool.active && (
          <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            inactive
          </span>
        )}
      </h3>
      <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
        {tool.description || "No description provided."}
      </p>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {tool.method} {tool.endpoint}
      </p>
    </section>
  );
}

/** The durable catalog of AI Tools plugins offer -- every tool ever
 * registered, whether or not the plugin that provides it is running right now
 * (whether it's callable right now is the Live Tools view). No runnable
 * example here: unlike Live Tools' entries, catalog rows don't carry a full
 * JSON-Schema parameter list to build one from. This page has nothing to log
 * in for -- it's read-only either way. */
export function AvailableToolsPage() {
  const fetchCatalogPage = useCallback(async (offset: number) => {
    const res = await apiFetch<CatalogToolsResponse>(
      `/v1/marketplace/ai/tools?active_only=false&limit=20&offset=${offset}`,
    );
    return { items: res.tools, total: res.total };
  }, []);
  const {
    items: catalogTools,
    status: catalogStatus,
    isError: isCatalogStatusError,
    reload: reloadCatalogTools,
    loadMore: loadMoreCatalogTools,
    hasMore: hasMoreCatalogTools,
  } = usePaginatedList(fetchCatalogPage);

  useEffect(() => {
    reloadCatalogTools();
  }, [reloadCatalogTools]);

  return (
    <>
      <PageHeader
        icon="ai-tools"
        title="AI Tool Catalog"
        subtitle={
          <>
            The durable catalog of AI Tools plugins offer, with tier info —
            includes tools from plugins that aren't running right now, and can
            lag behind{" "}
            <Link to="/ai-tools/installed" className="underline hover:text-indigo-600 dark:hover:text-indigo-400">
              Live Tools
            </Link>{" "}
            since it's only updated when a plugin (re)loads. This page has
            nothing to log in for — it's read-only either way.
          </>
        }
      />
      <InfoCallout icon="info">
        This is the catalog, not what's callable right now. A tool listed
        here is only callable once the plugin that provides it is installed
        and running — see{" "}
        <Link to="/ai-tools/installed" className="underline hover:text-indigo-600 dark:hover:text-indigo-400">
          Live Tools
        </Link>{" "}
        for what's live this moment.
      </InfoCallout>
      <StatusLine isError={isCatalogStatusError}>{catalogStatus}</StatusLine>
      {catalogTools.length === 0 && (
        <EmptyState>No AI tools in the catalog yet.</EmptyState>
      )}
      {catalogTools.map((t) => (
        <CatalogToolCard key={t.id} tool={t} />
      ))}
      {hasMoreCatalogTools && (
        <button onClick={loadMoreCatalogTools} className={secondaryButtonClass}>
          Load more
        </button>
      )}
    </>
  );
}
