import { useRef, useState } from "react";
import { Link } from "react-router-dom";

import { useI18n } from "../i18n";
import { CARD_STEP, type Onboarding, type OnboardingChanges, orderSteps } from "../lib/onboarding";
import { MODEL_PROVIDERS_DOCS_URL, type ReadinessCheck, useReadiness } from "../lib/readiness";
import type { AsyncResource } from "../lib/useAsyncResource";
import { useAccess, useCan } from "../lib/useCan";
import { useJourney } from "../lib/useJourney";
import { cardClass, ghostButtonClass, iconButtonClass } from "../lib/ui";
import { ExternalLink } from "./ExternalLink";
import { Icon, type IconName } from "./Icon";
import { InfoCallout } from "./InfoCallout";
import { Skeleton } from "./Skeleton";

interface Step {
  id: string;
  /** Where the step is done; empty when there is no page for it (email is
   * installation configuration). */
  to: string;
  icon: IconName;
  title: string;
  hint: string;
  /** Set for a step the server can see: done when the check passes. Steps
   * without one are done once stored as done (by the user, or by the page
   * where it happens, e.g. Ask after the first answer). */
  check?: ReadinessCheck | { ready: boolean; reason: null };
}

/**
 * Home's "Getting started" checklist (owner decision O1, client#126).
 *
 * Per role: someone who can connect a model (an org owner/admin, a Platform
 * Admin) gets the setup path -- model, knowledge base, upload, assistant, ask,
 * invite -- and a Platform Admin also email; a member gets their own next
 * steps -- ask, use a knowledge base, profile. Completion comes from the
 * readiness checks and the knowledge-base counts where the server can see it,
 * and from the stored onboarding state otherwise; skipping a step or hiding
 * the card is stored too, so it stays hidden on every device. The intro
 * answers, when given, reorder the steps.
 *
 * It also owns the "no model" readiness state: a member (who has no model
 * step) or an admin whose checklist is hidden still gets a notice.
 */
export function GettingStarted({
  onboarding,
}: {
  onboarding: AsyncResource<Onboarding> & { update: (c: OnboardingChanges) => Promise<void> };
}) {
  const { t } = useI18n();
  const readiness = useReadiness();
  const journey = useJourney();
  const canSetUp = useCan("org.ai.manage");
  const canInvite = useCan("org.members.invite");
  const { isPlatformAdmin } = useAccess();
  const [saveFailed, setSaveFailed] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const checks = readiness.data?.checks;
  const stored = onboarding.data?.checklist ?? {};
  const model = checks?.model;
  const modelHint =
    model?.reason === "model_service_unavailable"
      ? t("onboarding.model.unavailable")
      : t("onboarding.model.noModel");

  const hintFor = (check: Step["check"], hint: string) => {
    if (!check || check.ready) return hint;
    if (check.reason?.endsWith("_service_unavailable")) return t("onboarding.checklist.serviceUnavailable");
    if (check.reason === "not_authorized") return t("onboarding.checklist.notAuthorized");
    return hint;
  };
  const step = (
    id: string,
    to: string,
    icon: IconName,
    key: "knowledgeBase" | "upload" | "assistant" | "ask" | "invite" | "email" | "useKb" | "profile",
    check?: Step["check"],
  ): Step => ({
    id,
    to,
    icon,
    check,
    title: t(`onboarding.checklist.steps.${key}.title`),
    hint: hintFor(check, t(`onboarding.checklist.steps.${key}.hint`)),
  });

  const ask = step("ask", "/ask", "ask", "ask");
  // Extension point: the "Get to know Minder" sample assistant (owner decision
  // O2) becomes a step here once the server seeds it for every organization.
  const steps: Step[] = canSetUp
    ? [
        {
          id: "model",
          to: "/platform/providers",
          icon: "models",
          check: model,
          title: t("onboarding.model.title"),
          hint: modelHint,
        },
        step("knowledge_base", "/rag", "knowledge-bases", "knowledgeBase", checks?.knowledge_base),
        step(
          "upload",
          "/rag",
          "upload",
          "upload",
          journey.data ? { ready: journey.data.readyKbCount > 0, reason: null } : undefined,
        ),
        step("assistant", "/rag/pipelines", "pipelines", "assistant", checks?.pipeline),
        ask,
        ...(canInvite ? [step("invite", "/organization", "users", "invite")] : []),
        ...(isPlatformAdmin ? [step("email", "", "mail", "email", checks?.email)] : []),
      ]
    : [
        ask,
        step("use_kb", "/rag", "knowledge-bases", "useKb", checks?.knowledge_base),
        step("profile", "/settings", "user", "profile"),
      ];

  const visible = orderSteps(
    steps.filter((s) => stored[s.id] !== "dismissed"),
    onboarding.data?.intended_use,
    onboarding.data?.team_mode,
  );
  const isDone = (s: Step) => stored[s.id] === "done" || s.check?.ready === true;
  const doneCount = visible.filter(isDone).length;
  const cardHidden = stored[CARD_STEP] === "dismissed" || doneCount === visible.length;
  const loading =
    (onboarding.loading && !onboarding.data) ||
    (readiness.loading && !readiness.data) ||
    (canSetUp && journey.loading && !journey.data);

  async function save(changes: OnboardingChanges) {
    setSaveFailed(false);
    try {
      await onboarding.update(changes);
      headingRef.current?.focus();
    } catch {
      setSaveFailed(true);
    }
  }

  const modelShownInChecklist =
    canSetUp && !cardHidden && visible.some((s) => s.id === "model");
  const modelNotice =
    model && !model.ready && !modelShownInChecklist ? (
      <div className="mb-6">
        <InfoCallout icon="models" tone="warn">
          {canSetUp ? (
            <>
              {modelHint}{" "}
              <Link to="/platform/providers" className="font-medium underline">
                {t("onboarding.model.providers")}
              </Link>
            </>
          ) : (
            t("onboarding.model.askAdmin")
          )}
        </InfoCallout>
      </div>
    ) : null;

  if (loading) return <Skeleton className="mb-6 h-48 w-full" />;
  if (cardHidden) return modelNotice;

  return (
    <>
      {modelNotice}
      <section aria-labelledby="getting-started-title" className={`mb-6 ${cardClass}`}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2
              id="getting-started-title"
              ref={headingRef}
              tabIndex={-1}
              className="text-base font-semibold text-gray-900 outline-none dark:text-gray-100"
            >
              {t("onboarding.checklist.title")}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("onboarding.checklist.progress", { done: doneCount, total: visible.length })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => save({ checklist: { [CARD_STEP]: "dismissed" } })}
            aria-label={t("onboarding.checklist.hide")}
            title={t("onboarding.checklist.hide")}
            className={iconButtonClass}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <ol className="flex flex-col divide-y divide-gray-100 dark:divide-gray-800">
          {visible.map((s) => {
            const done = isDone(s);
            const titleClass = done
              ? "text-gray-500 line-through dark:text-gray-400"
              : "text-gray-900 dark:text-gray-100";
            return (
              <li key={s.id} data-step={s.id} className="flex items-start gap-3 py-3">
                <span
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${
                    done
                      ? "bg-indigo-600 text-white ring-indigo-600"
                      : "bg-gray-100 text-gray-500 ring-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-700"
                  }`}
                >
                  <Icon name={done ? "check" : s.icon} size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  {s.to ? (
                    <Link
                      to={s.to}
                      className={`text-sm font-medium hover:text-indigo-600 dark:hover:text-indigo-400 ${titleClass}`}
                    >
                      {s.title}
                    </Link>
                  ) : (
                    <span className={`text-sm font-medium ${titleClass}`}>{s.title}</span>
                  )}
                  <span className="sr-only">
                    {" "}
                    ({done ? t("onboarding.checklist.done") : t("onboarding.checklist.notDone")})
                  </span>
                  {!done && (
                    <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">{s.hint}</p>
                  )}
                  {!done && s.id === "model" && (
                    <ExternalLink
                      href={MODEL_PROVIDERS_DOCS_URL}
                      className="mt-1 inline-block text-sm text-indigo-600 underline hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
                    >
                      {t("onboarding.model.docs")}
                    </ExternalLink>
                  )}
                </div>
                {!done && (
                  <div className="flex shrink-0 gap-1">
                    {!s.check && (
                      <button
                        type="button"
                        onClick={() => save({ checklist: { [s.id]: "done" } })}
                        aria-label={t("onboarding.checklist.markStepDone", { step: s.title })}
                        className={`${ghostButtonClass} !px-2 !py-1 text-xs`}
                      >
                        {t("onboarding.checklist.markDone")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => save({ checklist: { [s.id]: "dismissed" } })}
                      aria-label={t("onboarding.checklist.skipStep", { step: s.title })}
                      className={`${ghostButtonClass} !px-2 !py-1 text-xs`}
                    >
                      {t("onboarding.checklist.skip")}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {saveFailed && (
          <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
            {t("onboarding.checklist.saveFailed")}
          </p>
        )}
      </section>
    </>
  );
}
