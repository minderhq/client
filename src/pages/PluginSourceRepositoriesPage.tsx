import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { useConfirm } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { InfoCallout } from "../components/InfoCallout";
import { PageHeader } from "../components/PageHeader";
import { StatusLine } from "../components/StatusLine";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Installation } from "../lib/types";
import { useAsyncResource } from "../lib/useAsyncResource";
import { usePaginatedList } from "../lib/usePaginatedList";
import { badgeClass, cardClass, cardHoverClass, mutedTextClass, secondaryButtonClass } from "../lib/ui";
import { useTokenRef } from "../lib/useTokenRef";
import { PluginCard, type Plugin } from "./AvailablePluginsPage";

// #1516 (client half, groundwork already merged in minder#1725): a "plugin
// source repository" is the first-class grouping entity for the flat
// per-plugin `repository_url` string -- "this repo contributed N plugins"
// instead of N unrelated-looking listings. This is READ-ONLY, browse/manage
// UI only: minder#1725's comment explicitly split the remaining work into
// three buckets and said only this one (client grouping UI, over the
// already-shipped read endpoints) is safe to build now. There is
// deliberately no "register a repository" or "assign a plugin to a
// repository" affordance anywhere here -- who may register a source, and
// repo-level versioning semantics, are still-open product decisions (see the
// issue). Legacy plugins with a NULL `repository_id` simply never appear
// under any repository; that is correct, not an error state.

/** GET /v1/marketplace/repositories(/{id}) row shape --
 * models/repository.py's PluginRepositoryResponse, mirrored field-for-field. */
export interface PluginSourceRepository {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  source_url: string | null;
  owner: string | null;
  plugin_count: number;
  created_at: string;
  updated_at: string;
}

interface RepositoryListResponse {
  repositories: PluginSourceRepository[];
  count: number;
  total: number;
  limit: number;
  offset: number;
}

interface RepositoryPluginsResponse {
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

function RepositoryCard({ repository }: { repository: PluginSourceRepository }) {
  // The card itself is a plain div, not a Link -- source_url below is a real
  // <a>, and nesting an anchor inside a Link's rendered <a> is invalid DOM
  // (validateDOMNesting warns and some browsers mis-render click targets).
  // Only the title is the click-through to the detail view.
  return (
    <div className={`mb-4 ${cardClass} ${cardHoverClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
            <Icon name="sources" size={16} className="shrink-0 text-indigo-500 dark:text-indigo-400" />
            <Link
              to={`/plugins/sources/${repository.id}`}
              className="hover:underline"
            >
              {repository.name}
            </Link>
          </h2>
          {repository.description && (
            <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
              {repository.description}
            </p>
          )}
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-gray-500 dark:text-gray-400">
            {repository.owner && <span>by {repository.owner}</span>}
            {repository.source_url && (
              <a
                href={repository.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-indigo-600 dark:hover:text-indigo-400"
              >
                {repository.source_url} ↗
              </a>
            )}
          </p>
        </div>
        <span className={`shrink-0 ${badgeClass}`}>
          {repository.plugin_count} plugin{repository.plugin_count === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}

function RepositoryList() {
  const fetchPage = useCallback(async (offset: number) => {
    const res = await apiFetch<RepositoryListResponse>(
      `/v1/marketplace/repositories?limit=20&offset=${offset}`,
    );
    return { items: res.repositories, total: res.total };
  }, []);

  const { items: repositories, status, isError, reload, loadMore, hasMore } =
    usePaginatedList(fetchPage);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <>
      <StatusLine isError={isError}>{status}</StatusLine>

      {!status && repositories.length === 0 && (
        <EmptyState>
          No plugin source repositories yet. Plugins published without a
          linked repository (the common case today) still show up in the
          regular plugin catalog -- they're just not grouped under a source
          here.
        </EmptyState>
      )}

      {repositories.map((repo) => (
        <RepositoryCard key={repo.id} repository={repo} />
      ))}

      {hasMore && (
        <button onClick={loadMore} className={secondaryButtonClass}>
          Load more
        </button>
      )}
    </>
  );
}

function RepositoryPluginList({ repositoryId }: { repositoryId: string }) {
  const { token, sessionKey, isAuthenticated, role } = useAuth();
  const tokenRef = useTokenRef();
  const isAdmin = role === "admin";
  const { confirm, dialog } = useConfirm();
  const [myInstallations, setMyInstallations] = useState<Installation[]>([]);

  const loadMyInstallations = useCallback(async () => {
    if (!isAuthenticated) {
      setMyInstallations([]);
      return;
    }
    try {
      const res = await apiFetch<MyInstallationsResponse>(
        "/v1/marketplace/installations/me",
        { token: tokenRef.current },
      );
      setMyInstallations(res.installations);
    } catch {
      // best-effort -- an install action below will surface its own error
    }
  }, [isAuthenticated, tokenRef]);

  useEffect(() => {
    loadMyInstallations();
  }, [loadMyInstallations, sessionKey]);

  const fetchPage = useCallback(
    async (offset: number) => {
      const res = await apiFetch<RepositoryPluginsResponse>(
        `/v1/marketplace/repositories/${repositoryId}/plugins?limit=20&offset=${offset}`,
      );
      return { items: res.plugins, total: res.total };
    },
    [repositoryId],
  );

  const { items: plugins, status, isError, reload, loadMore, hasMore } =
    usePaginatedList(fetchPage);

  useEffect(() => {
    reload();
  }, [reload]);

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
      <StatusLine isError={isError}>{status}</StatusLine>

      {!status && plugins.length === 0 && (
        <EmptyState>
          This repository hasn't contributed any plugins yet.
        </EmptyState>
      )}

      {plugins.map((plugin) => (
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

      {hasMore && (
        <button onClick={loadMore} className={secondaryButtonClass}>
          Load more
        </button>
      )}
    </>
  );
}

function RepositoryDetail({ repositoryId }: { repositoryId: string }) {
  const repoRes = useAsyncResource(
    (signal) =>
      apiFetch<PluginSourceRepository>(
        `/v1/marketplace/repositories/${repositoryId}`,
        { signal },
      ),
    { deps: [repositoryId] },
  );

  const backLink = (
    <Link to="/plugins/sources" className={secondaryButtonClass}>
      <Icon name="arrow" size={14} /> All sources
    </Link>
  );

  if (repoRes.error) {
    // A 404 (unknown repository id) carries the backend's own "Repository not
    // found"; any other failure shows its message.
    return (
      <>
        <div className="mb-3">{backLink}</div>
        <InfoCallout icon="warning">{repoRes.error}</InfoCallout>
      </>
    );
  }

  const repo = repoRes.data;

  return (
    <>
      <div className="mb-3">{backLink}</div>

      {repoRes.loading && <StatusLine>Loading…</StatusLine>}

      {repo && (
        <div className={`mb-6 ${cardClass}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
                <Icon name="sources" size={18} className="shrink-0 text-indigo-500 dark:text-indigo-400" />
                {repo.name}
              </h2>
              {repo.description && (
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  {repo.description}
                </p>
              )}
              <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-gray-500 dark:text-gray-400">
                {repo.owner && <span>by {repo.owner}</span>}
                {repo.source_url && (
                  <a
                    href={repo.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-indigo-600 dark:hover:text-indigo-400"
                  >
                    {repo.source_url} ↗
                  </a>
                )}
              </p>
            </div>
            <span className={`shrink-0 ${badgeClass}`}>
              {repo.plugin_count} plugin{repo.plugin_count === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      )}

      {repo && (
        <>
          <h3 className={`mb-2 ${mutedTextClass} font-semibold uppercase tracking-wide`}>
            Plugins from this repository
          </h3>
          <RepositoryPluginList repositoryId={repositoryId} />
        </>
      )}
    </>
  );
}

export function PluginSourceRepositoriesPage() {
  const { repositoryId } = useParams();

  return (
    <>
      <PageHeader
        icon="sources"
        title="Plugin Sources"
        subtitle={
          repositoryId
            ? "One source repository's metadata and the plugins it contributed, read-only."
            : "Source repositories that group the marketplace's plugins by where they come from, read-only. Plugins published without a linked repository still appear in the regular catalog."
        }
      />

      {repositoryId ? (
        <RepositoryDetail repositoryId={repositoryId} />
      ) : (
        <RepositoryList />
      )}
    </>
  );
}
