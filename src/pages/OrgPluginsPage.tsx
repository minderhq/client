import { Link } from "react-router-dom";

import { CardListSkeleton } from "../components/CardListSkeleton";
import { useConfirm } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { LoadError } from "../components/LoadError";
import { PageHeader } from "../components/PageHeader";
import { useI18n } from "../i18n";
import { fetchRequestInbox } from "../lib/accessRequests";
import { useAuth } from "../lib/auth";
import { ROUTES } from "../lib/routes";
import { useAsyncResource } from "../lib/useAsyncResource";
import { useInstalledPlugins } from "../lib/useInstalledPlugins";
import { useTokenRef } from "../lib/useTokenRef";
import { InstalledPluginCard } from "./InstalledPluginsPage";

/** Organization › Plugins (UX step 9, client#126 Q3): the plugins installed
 * for the whole organization (an installation with `tenant_id`), with the
 * same enable / disable / uninstall and settings as Marketplace › Installed --
 * for an org admin those act on the org's install. Pending install requests
 * are counted here and decided in the Requests inbox. The route is gated on
 * org.settings.manage, the marketplace's own install gate. */
export function OrgPluginsPage() {
  const { token, sessionKey, isAuthenticated } = useAuth();
  const { t, plural } = useI18n();
  const tokenRef = useTokenRef();
  const { confirm, dialog } = useConfirm();
  const plugins = useInstalledPlugins({ enabled: isAuthenticated, tokenRef, sessionKey });
  // A failed inbox load only hides the count; the Requests page says why.
  const inbox = useAsyncResource((signal) => fetchRequestInbox("pending", token, signal), {
    enabled: !!token,
    deps: [sessionKey],
  });
  const pending = (inbox.data?.requests ?? []).filter((r) => r.kind === "plugin_install").length;
  const orgEntries = plugins.entries.filter((e) => e.installation?.tenant_id);

  return (
    <>
      {dialog}
      <PageHeader
        icon="plugins"
        title={t("nav.items.orgPlugins.title")}
        subtitle={t("orgPlugins.subtitle")}
      />
      {pending > 0 && (
        <p className="mb-4 flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <Icon name="send" size={15} className="text-indigo-500 dark:text-indigo-400" />
          {plural("orgPlugins.pending", pending)}
          <Link
            to={ROUTES.requests}
            className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            {t("orgPlugins.openRequests")}
          </Link>
        </p>
      )}
      {plugins.installationsError ? (
        <LoadError
          title={t("orgPlugins.loadError")}
          message={plugins.installationsError}
          onRetry={plugins.reload}
          what={t("nav.items.orgPlugins.title")}
        />
      ) : plugins.loading && plugins.installations === null ? (
        <CardListSkeleton />
      ) : orgEntries.length === 0 ? (
        <EmptyState>
          {t("orgPlugins.empty")}{" "}
          <Link
            to={ROUTES.discoverPlugins}
            className="underline hover:text-indigo-600 dark:hover:text-indigo-400"
          >
            {t("orgPlugins.discover")}
          </Link>
        </EmptyState>
      ) : (
        orgEntries.map((entry) => (
          <InstalledPluginCard
            key={entry.key}
            entry={entry}
            token={token}
            runtimeKnown={plugins.runtime !== null && !plugins.runtimeTruncated}
            onUninstalled={plugins.removeInstallation}
            onToggleEnabled={plugins.setInstallationEnabled}
            confirm={confirm}
          />
        ))
      )}
    </>
  );
}
