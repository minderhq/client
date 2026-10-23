import { useId, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { useI18n } from "../i18n";
import { type PlanTier, tierLabel, upgradeTierFor } from "../lib/billing";
import { ROUTES } from "../lib/routes";
import { primaryButtonClass, secondaryButtonClass } from "../lib/ui";
import { useEntitlement } from "../lib/useEntitlement";
import { InfoCallout } from "./InfoCallout";
import { RequestButton } from "./RequestButton";

/** A plan limit at the moment it matters (plan-gating §12): what happened,
 * then what the caller can do about it, by who they are and where this runs
 * (client#126 Q6.1, Q6.4, Q6.5):
 *
 *  - SaaS billing owner: Try 14 days / Upgrade;
 *  - anyone else on SaaS: "Ask the billing owner" (a plan request);
 *  - self-hosted: "Requires a … licence", no buy buttons; non-operators can
 *    still ask the installation's admins for a licence;
 *  - air-gapped: no outside links; the operator gets "Upload licence file".
 *
 * Without `requires` (nothing to upgrade to) only the message is shown.
 * Render it for admins only: members get state and solution, never a sale. */
export function LimitNotice({ requires, children }: { requires: PlanTier | null; children: ReactNode }) {
  const { t } = useI18n();
  const { canManageBilling, deployment } = useEntitlement();
  const hintId = useId();
  if (!requires) {
    return (
      <InfoCallout icon="warning">
        <div>{children}</div>
      </InfoCallout>
    );
  }
  const plan = tierLabel(requires);
  const saas = deployment === "saas";
  const notYet = (
    <span id={hintId} className="text-xs">
      {t("plans.notYet")}
    </span>
  );

  let actions: ReactNode = null;
  if (!canManageBilling) {
    actions = <RequestButton kind="plan_request" subject={requires} name={plan} />;
  } else if (saas) {
    actions = (
      <>
        <Link to={ROUTES.billing} className={primaryButtonClass}>
          {t("plans.upgrade")}
        </Link>
        {/* shortcut: the 14-day trial has no API yet; wire it when the gateway adds one. */}
        <button type="button" className={secondaryButtonClass} disabled aria-describedby={hintId}>
          {t("plans.trial", { plan })}
        </button>
        {notYet}
      </>
    );
  } else if (deployment === "air-gapped") {
    actions = (
      <>
        {/* shortcut: licence files are installed with the server's setup tool; no API to upload one yet. */}
        <button type="button" className={secondaryButtonClass} disabled aria-describedby={hintId}>
          {t("plans.uploadLicence")}
        </button>
        {notYet}
      </>
    );
  }

  return (
    <InfoCallout icon="warning">
      <div>{children}</div>
      <div>{saas ? t("plans.inPlan", { plan }) : t("plans.requiresLicence", { plan })}</div>
      {actions && <div className="mt-2 flex flex-wrap items-center gap-2">{actions}</div>}
    </InfoCallout>
  );
}

/** The honest seat count for the org's managers (plan-gating §7): always the
 * plain count, and a {@link LimitNotice} once the org is at or over its
 * limit ("14/10 Community seats in use"). Nothing for a caller who may not
 * see seats, or when seats are unlimited. */
export function SeatBanner() {
  const { t } = useI18n();
  const { seats, tier } = useEntitlement();
  if (!seats || seats.max == null || !tier) return null;
  const count = t("plans.seats", { used: seats.used, max: seats.max, plan: tierLabel(tier) });
  if (seats.state !== "at_limit" && seats.state !== "over_limit") {
    return <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">{count}</p>;
  }
  return (
    <div className="mb-3">
      <LimitNotice requires={upgradeTierFor(tier)}>
        <strong>{count}</strong>
        {seats.behaviour === "hard" && <> {t("plans.seatsHard")}</>}
      </LimitNotice>
    </div>
  );
}
