import { useState } from "react";

import { Icon } from "../components/Icon";
import { InfoCallout } from "../components/InfoCallout";
import { PageHeader } from "../components/PageHeader";
import { StatusLine } from "../components/StatusLine";
import { useI18n } from "../i18n";
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
  const { t } = useI18n();
  return (
    <div className="mb-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-lg font-semibold text-gray-900 dark:text-gray-100">
          <Icon name="billing" className="h-5 w-5" />
          {titleCase(sub.tier)}
        </span>
        {sub.baseline ? (
          <span className={`${badgeClass} ${neutralTone}`}>{t("billing.freePlan")}</span>
        ) : (
          <span className={`${badgeClass} ${statusTone(sub.status)}`}>
            {sub.status ?? t("billing.statusActive")}
          </span>
        )}
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm text-gray-600 dark:text-gray-400 sm:grid-cols-2">
        {sub.valid_until && (
          <div className="flex justify-between gap-2">
            <dt>{t("billing.validUntil")}</dt>
            <dd className="font-mono text-xs">{sub.valid_until.slice(0, 10)}</dd>
          </div>
        )}
        {sub.provider && (
          <div className="flex justify-between gap-2">
            <dt>{t("billing.provider")}</dt>
            <dd>{sub.provider}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export function BillingPage() {
  const { t } = useI18n();
  const { token, sessionKey } = useAuth();

  // Keyed on the session identity (user + active org): an org switch that
  // doesn't remount the page must not leave the previous org's plan and
  // can_manage on screen (#64).
  const subRes = useAsyncResource(
    (signal) => fetchSubscription(token, signal),
    { enabled: Boolean(token), deps: [sessionKey] },
  );

  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleUpgrade(tier: string) {
    if (busy) return; // already in flight
    setBusy(true);
    setIsError(false);
    setStatus(t("billing.startingCheckout", { tier: titleCase(tier) }));
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
    setStatus(t("billing.openingPortal"));
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
  // minder#2036: members without billing-manage authority get a read-only view.
  const canManage = sub?.can_manage !== false;

  return (
    <>
      <PageHeader
        icon="billing"
        title={t("billing.title")}
        subtitle={t("billing.subtitle")}
      />

      {!token && (
        <InfoCallout icon="lock">{t("billing.logInToView")}</InfoCallout>
      )}

      {subRes.loading && !sub && <StatusLine>{t("billing.loading")}</StatusLine>}
      {subRes.error && <StatusLine isError>{subRes.error}</StatusLine>}

      {sub && (
        <>
          <PlanCard sub={sub} />

          {!canManage && (
            <InfoCallout icon="lock">
              {t("billing.ownersOnly")}
            </InfoCallout>
          )}

          {canManage && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {sub.manageable && (
                <button
                  onClick={handleManage}
                  disabled={busy}
                  className={secondaryButtonClass}
                >
                  <Icon name="billing" className="mr-1.5 h-4 w-4" />
                  {t("billing.manage")}
                </button>
              )}
              {UPGRADE_TIERS.filter((t) => t !== sub.tier).map((tier) => (
                <button
                  key={tier}
                  onClick={() => handleUpgrade(tier)}
                  disabled={busy}
                  className={primaryButtonClass}
                >
                  {t("billing.upgradeTo", { tier: titleCase(tier) })}
                </button>
              ))}
            </div>
          )}

          {status && <StatusLine isError={isError}>{status}</StatusLine>}
        </>
      )}
    </>
  );
}
