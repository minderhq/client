import { useState } from "react";

import { Icon } from "../components/Icon";
import { InfoCallout } from "../components/InfoCallout";
import { PageHeader } from "../components/PageHeader";
import { StatusLine } from "../components/StatusLine";
import { friendlyErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  fetchSubscription,
  openBillingPortal,
  startCheckout,
  UPGRADE_TIERS,
  type Subscription,
} from "../lib/billing";
import { redirectTo } from "../lib/redirect";
import { badgeClass, badgeTone, primaryButtonClass, secondaryButtonClass } from "../lib/ui";
import { useAsyncResource } from "../lib/useAsyncResource";

// badgeTone (lib/ui) intentionally carries only success/warn/danger; a neutral
// grey is local to this page (the free-plan / no-status case).
const neutralTone = "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";

function titleCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function statusTone(status: string | null): string {
  if (status === "active") return badgeTone.success;
  if (status === "canceled" || status === "expired") return badgeTone.danger;
  if (status) return badgeTone.warn; // past_due / unpaid / paused / …
  return neutralTone;
}

export function PlanCard({ sub }: { sub: Subscription }) {
  return (
    <div className="mb-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-lg font-semibold text-gray-900 dark:text-gray-100">
          <Icon name="billing" className="h-5 w-5" />
          {titleCase(sub.tier)}
        </span>
        {sub.baseline ? (
          <span className={`${badgeClass} ${neutralTone}`}>free plan</span>
        ) : (
          <span className={`${badgeClass} ${statusTone(sub.status)}`}>
            {sub.status ?? "active"}
          </span>
        )}
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm text-gray-600 dark:text-gray-400 sm:grid-cols-2">
        {sub.valid_until && (
          <div className="flex justify-between gap-2">
            <dt>Renews / valid until</dt>
            <dd className="font-mono text-xs">{sub.valid_until.slice(0, 10)}</dd>
          </div>
        )}
        {sub.provider && (
          <div className="flex justify-between gap-2">
            <dt>Provider</dt>
            <dd>{sub.provider}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export function BillingPage() {
  const { token } = useAuth();

  const subRes = useAsyncResource(
    (signal) => fetchSubscription(token, signal),
    { enabled: Boolean(token) },
  );

  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleUpgrade(tier: string) {
    if (busy) return; // already in flight
    setBusy(true);
    setIsError(false);
    setStatus(`Starting checkout for ${titleCase(tier)}…`);
    try {
      const { checkout_url } = await startCheckout(tier, token);
      redirectTo(checkout_url);
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
      setBusy(false);
    }
  }

  async function handleManage() {
    if (busy) return;
    setBusy(true);
    setIsError(false);
    setStatus("Opening the customer portal…");
    try {
      const { portal_url } = await openBillingPortal(token);
      redirectTo(portal_url);
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
      setBusy(false);
    }
  }

  const sub = subRes.data;

  return (
    <>
      <PageHeader
        icon="billing"
        title="Billing"
        subtitle="Your organization's plan and subscription. Upgrades and payment management happen on the provider's secure hosted pages."
      />

      {!token && (
        <InfoCallout icon="lock">Log in to view your organization's plan.</InfoCallout>
      )}

      {subRes.loading && !sub && <StatusLine>Loading your plan…</StatusLine>}
      {subRes.error && <StatusLine isError>{subRes.error}</StatusLine>}

      {sub && (
        <>
          <PlanCard sub={sub} />

          <div className="mb-2 flex flex-wrap items-center gap-2">
            {sub.manageable && (
              <button
                onClick={handleManage}
                disabled={busy}
                className={secondaryButtonClass}
              >
                <Icon name="billing" className="mr-1.5 h-4 w-4" />
                Manage subscription
              </button>
            )}
            {UPGRADE_TIERS.filter((t) => t !== sub.tier).map((tier) => (
              <button
                key={tier}
                onClick={() => handleUpgrade(tier)}
                disabled={busy}
                className={primaryButtonClass}
              >
                Upgrade to {titleCase(tier)}
              </button>
            ))}
          </div>

          {status && <StatusLine isError={isError}>{status}</StatusLine>}
        </>
      )}
    </>
  );
}
