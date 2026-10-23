import { useI18n } from "../i18n";
import { type PlanTier, tierLabel } from "../lib/billing";
import { badgeBaseClass } from "../lib/ui";

/** The small "Pro" / "Enterprise" badge beside a plan feature, e.g. a tab in
 * the admin settings sub-navigation (client#126 Q6.3). Screen readers hear the
 * whole sentence ("Available on the Pro plan"), not just the plan name. */
export function PlanBadge({ tier }: { tier: PlanTier }) {
  const { t } = useI18n();
  const plan = tierLabel(tier);
  const full = t("plans.badge", { plan });
  return (
    <span
      className={`${badgeBaseClass} bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300`}
      title={full}
    >
      <span aria-hidden="true">{plan}</span>
      <span className="sr-only">{full}</span>
    </span>
  );
}
