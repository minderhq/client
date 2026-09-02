import { Icon } from "../components/Icon";
import { EmptyState } from "../components/EmptyState";
import { InfoCallout } from "../components/InfoCallout";
import { PageHeader } from "../components/PageHeader";
import { StatusLine } from "../components/StatusLine";
import { apiFetch } from "../lib/api";
import { useAsyncResource } from "../lib/useAsyncResource";
import { useAuth } from "../lib/auth";
import { badgeClass, badgeTone, cardClass, mutedTextClass } from "../lib/ui";

export interface License {
  id: string;
  plugin_id: string;
  plugin_name: string;
  plugin_display_name: string;
  tier: string;
  valid_from: string;
  valid_until: string | null;
  active: boolean;
  usage_count: number;
  last_used_at: string | null;
}

interface LicenseListResponse {
  licenses: License[];
  count: number;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// A license's `active` column doesn't get flipped by any background job when
// `valid_until` passes -- validate_license only notices expiry at the moment
// something tries to use the key. So the effective status shown here is
// computed client-side from both fields, not just echoed from `active`.
export function licenseStatus(license: License): { label: string; tone: string } {
  if (!license.active) {
    return { label: "Inactive", tone: badgeTone.danger };
  }
  if (license.valid_until && new Date(license.valid_until) < new Date()) {
    return { label: "Expired", tone: badgeTone.danger };
  }
  return { label: "Active", tone: badgeTone.success };
}

function LicenseCard({ license }: { license: License }) {
  const status = licenseStatus(license);
  return (
    <section className={`mb-4 ${cardClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
            <Icon name="licenses" size={16} className="shrink-0 text-indigo-500 dark:text-indigo-400" /> {license.plugin_display_name}
          </h3>
          <p className={`mt-1 ${mutedTextClass}`}>
            {license.plugin_name} · <span className={badgeClass}>{license.tier}</span>
          </p>
        </div>
        <span className={`${badgeClass} ${status.tone} flex-shrink-0`}>
          {status.label}
        </span>
      </div>
      <p className={`mt-3 ${mutedTextClass}`}>
        Valid {formatDate(license.valid_from)}
        {license.valid_until ? ` – ${formatDate(license.valid_until)}` : " – no expiry"}
      </p>
    </section>
  );
}

export function MyLicensesPage() {
  const { token, isAuthenticated } = useAuth();
  const { data, error, loading } = useAsyncResource(
    (signal) =>
      apiFetch<LicenseListResponse>("/v1/marketplace/licenses", { token, signal }),
    { deps: [token], enabled: isAuthenticated },
  );
  const licenses = data?.licenses ?? [];

  return (
    <>
      <PageHeader
        icon="licenses"
        title="My Licenses"
        subtitle="The plugin tiers licensed to your account. Licenses are currently granted by an administrator — there's no self-service upgrade yet."
      />

      {!isAuthenticated ? (
        <InfoCallout icon="lock">Log in to see your plugin licenses.</InfoCallout>
      ) : (
        <>
          <StatusLine isError={!!error}>
            {error ?? (loading ? "Loading your licenses…" : "")}
          </StatusLine>
          {licenses.length === 0 && !loading && !error ? (
            <EmptyState>
              You don't have any plugin licenses yet. Licenses are currently
              granted by an administrator.
            </EmptyState>
          ) : (
            licenses.map((l) => <LicenseCard key={l.id} license={l} />)
          )}
        </>
      )}
    </>
  );
}
