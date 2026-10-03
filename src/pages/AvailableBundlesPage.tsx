import { Link } from "react-router-dom";

import { BundleCard } from "../components/BundleCard";
import { EmptyState } from "../components/EmptyState";
import { InfoCallout } from "../components/InfoCallout";
import { PageHeader } from "../components/PageHeader";
import { StatusLine } from "../components/StatusLine";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth";
import { type BundlesResponse } from "../lib/bundles";
import { ROUTES } from "../lib/routes";
import { useAsyncResource } from "../lib/useAsyncResource";

/** Bundles NOT currently enabled -- the ones you could turn on. A bundle that
 * gets enabled here disappears from this list and reappears on Installed
 * service bundles, mirroring how Discover and Installed plugins behave. */
export function AvailableBundlesPage() {
  const { token, role } = useAuth();
  const isAdmin = role === "admin";
  // Single whole-object read -> useAsyncResource (cancels on unmount, drops a
  // stale response). Enabling a bundle refreshes via reload(). #502
  const bundlesRes = useAsyncResource((signal) =>
    apiFetch<BundlesResponse>("/v1/bundles", { signal }),
  );
  const available = (bundlesRes.data?.bundles ?? []).filter((b) => !b.enabled);

  return (
    <>
      <PageHeader
        icon="bundles"
        title="Discover service bundles"
        subtitle="Optional service bundles you haven't turned on yet — each claims a set of services shared with other bundles where needed. Browsing is open for everyone; enabling requires an admin account."
      />
      <InfoCallout icon="info">
        Enabling only starts containers that already exist. A service that
        was never brought up (e.g. this bundle has been off since install)
        shows as needing a host converge — run <code>./setup.sh start</code>{" "}
        or <code>./setup.sh restart</code> on the host to actually create it.
      </InfoCallout>
      <StatusLine isError={!!bundlesRes.error}>
        {bundlesRes.error ?? (bundlesRes.loading ? "Loading…" : "")}
      </StatusLine>

      {bundlesRes.data && available.length === 0 && (
        <EmptyState>
          Every service bundle is already enabled — see{" "}
          <Link to={ROUTES.installedServiceBundles} className="underline hover:text-indigo-600 dark:hover:text-indigo-400">
            Installed service bundles
          </Link>
          .
        </EmptyState>
      )}
      {available.map((b) => (
        <BundleCard
          key={b.name}
          bundle={b}
          token={token}
          isAdmin={isAdmin}
          onChanged={bundlesRes.reload}
        />
      ))}
    </>
  );
}
