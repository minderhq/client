import { useId } from "react";
import { Link } from "react-router-dom";

import { BundleAdminNote, BundleCard } from "../components/BundleCard";
import { CardListSkeleton } from "../components/CardListSkeleton";
import { EmptyState } from "../components/EmptyState";
import { InfoCallout } from "../components/InfoCallout";
import { LoadError } from "../components/LoadError";
import { PageHeader } from "../components/PageHeader";
import { StatusLine } from "../components/StatusLine";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth";
import { BUNDLE_TOGGLE_ACTION, type BundlesResponse, bundleAdminReason } from "../lib/bundles";
import { ROUTES } from "../lib/routes";
import { useAsyncResource } from "../lib/useAsyncResource";
import { useI18n } from "../i18n";

/** Bundles NOT currently enabled -- the ones you could turn on. A bundle that
 * gets enabled here disappears from this list and reappears on Installed
 * service bundles, mirroring how Discover and Installed plugins behave. */
export function AvailableBundlesPage() {
  const { t, rich } = useI18n();
  const { token, isPlatformAdmin } = useAuth();
  const isAdmin = isPlatformAdmin;
  const adminNoteId = useId();
  const adminReason = bundleAdminReason(isAdmin, !!token, BUNDLE_TOGGLE_ACTION);
  // Single whole-object read -> useAsyncResource (cancels on unmount, drops a
  // stale response). Enabling a bundle refreshes via reload(). #502
  const bundlesRes = useAsyncResource((signal) =>
    apiFetch<BundlesResponse>("/v1/bundles", { signal, cache: true }),
  );
  const available = (bundlesRes.data?.bundles ?? []).filter((b) => !b.enabled);

  return (
    <>
      <PageHeader
        icon="bundles"
        title={t("nav.items.modulesDiscover.title")}
        subtitle={t("modules.availableSubtitle")}
      />
      <InfoCallout icon="info">
        {rich("modules.neverStarted", {
          start: <code>./setup.sh start</code>,
          restart: <code>./setup.sh restart</code>,
        })}
      </InfoCallout>
      <StatusLine>{bundlesRes.loading ? t("modules.loading") : ""}</StatusLine>
      {bundlesRes.error && (
        <LoadError
          title={t("modules.loadError")}
          message={bundlesRes.error}
          what={t("modules.what")}
          onRetry={bundlesRes.reload}
        />
      )}

      <h2 className="sr-only">{t("modules.canEnable")}</h2>
      {bundlesRes.loading && !bundlesRes.data && <CardListSkeleton />}
      {bundlesRes.data && !bundlesRes.error && available.length === 0 && (
        <EmptyState>
          {rich("modules.allEnabled", {
            link: (
              <Link to={ROUTES.installedModules} className="underline hover:text-indigo-600 dark:hover:text-indigo-400">
                {t("nav.items.modulesInstalled.title")}
              </Link>
            ),
          })}
        </EmptyState>
      )}
      {adminReason && available.length > 0 && (
        <BundleAdminNote id={adminNoteId} reason={adminReason} />
      )}
      {available.map((b) => (
        <BundleCard
          key={b.name}
          bundle={b}
          token={token}
          isAdmin={isAdmin}
          onChanged={bundlesRes.reload}
          adminNoteId={adminReason ? adminNoteId : undefined}
        />
      ))}
    </>
  );
}
