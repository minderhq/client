import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { GettingStarted } from "../components/GettingStarted";
import { HealthStrip } from "../components/HealthStrip";
import { Icon, type IconName } from "../components/Icon";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/catalog";
import { useAuth } from "../lib/auth";
import { useOnboarding } from "../lib/onboarding";
import { cardClass, cardHoverClass, primaryButtonClass, sectionLabelClass } from "../lib/ui";
import { useAccess } from "../lib/useCan";

const SHORTCUTS: { to: string; icon: IconName; label: MessageKey; description: MessageKey }[] = [
  { to: "/ask", icon: "ask", label: "nav.items.ask.label", description: "nav.items.ask.description" },
  {
    to: "/rag",
    icon: "knowledge-bases",
    label: "nav.items.knowledgeBases.label",
    description: "nav.items.knowledgeBases.description",
  },
  {
    to: "/rag/conversations",
    icon: "conversations",
    label: "nav.items.conversations.label",
    description: "nav.items.conversations.description",
  },
];

/** Whether this is the caller's first visit: nothing was stored for them
 * yet. Decided once per mount, so the welcome doesn't flip to "welcome back"
 * the moment the visit is recorded; null until the state has loaded. */
function useFirstVisit(onboarding: ReturnType<typeof useOnboarding>): boolean | null {
  const { data, update } = onboarding;
  const first = data ? data.created_at === null : null;
  const [firstVisit, setFirstVisit] = useState<boolean | null>(null);
  if (firstVisit === null && first !== null) setFirstVisit(first);
  useEffect(() => {
    // An empty (merged) checklist stores the row, i.e. records the visit.
    if (first) update({ checklist: {} }).catch(() => {});
  }, [first, update]);
  return firstVisit;
}

/** The role-aware home (ux-design §3, client#126 step 3): a greeting that
 * knows a first visit from a return, the "Getting started" checklist for the
 * caller's role with the readiness states, the installation's health for a
 * Platform Admin, and shortcuts into the product. */
export function HomePage() {
  const { isAuthenticated, username } = useAuth();
  const { isPlatformAdmin } = useAccess();
  const { t } = useI18n();
  const onboarding = useOnboarding();
  const firstVisit = useFirstVisit(onboarding);

  const title = !isAuthenticated
    ? "Minder"
    : firstVisit === true
      ? t("home.greetingFirst", { name: username })
      : firstVisit === false
        ? t("home.greetingReturning", { name: username })
        : t("home.greeting", { name: username });
  const intro = !isAuthenticated
    ? t("home.introAnonymous")
    : firstVisit
      ? t("home.introFirst")
      : t("home.introReturning");

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{title}</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{intro}</p>
        </div>
        <Link to="/ask" className={primaryButtonClass}>
          <Icon name="ask" size={16} />
          {t("home.ask")}
        </Link>
      </div>

      {isAuthenticated && <GettingStarted onboarding={onboarding} />}
      {isPlatformAdmin && <HealthStrip />}

      <section aria-labelledby="home-shortcuts" className="mb-6">
        <h2 id="home-shortcuts" className={`mb-2 ${sectionLabelClass}`}>
          {t("home.shortcuts")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {SHORTCUTS.map((s) => (
            <Link
              key={s.to}
              to={s.to}
              className={`group flex items-start gap-3 ${cardClass} ${cardHoverClass} !p-3.5`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600 transition group-hover:bg-indigo-50 group-hover:text-indigo-600 dark:bg-gray-800 dark:text-gray-300 dark:group-hover:bg-indigo-950/50 dark:group-hover:text-indigo-300">
                <Icon name={s.icon} size={17} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-gray-800 dark:text-gray-200">
                  {t(s.label)}
                </span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">
                  {t(s.description)}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
