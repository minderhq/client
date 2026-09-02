import { Link } from "react-router-dom";

import {
  JOURNEY_STEPS,
  type JourneyCounts,
  primaryAction,
  stepStatus,
} from "../lib/journey";
import { useAuth } from "../lib/auth";
import { useJourney } from "../lib/useJourney";
import { cardClass } from "../lib/ui";
import { Icon } from "./Icon";

/** The persistent KB → Upload → Pipeline → Ask checklist shown at the top of
 * every Knowledge page (#1226). Before this, HomePage's suggestion card was the
 * ONLY journey-aware element — the moment you left Home the hand-holding
 * stopped and each Knowledge page was an island that assumed you already knew
 * the sequence. This carries the same `primaryAction` logic (via completedStep-
 * Count) onto each page so the "you are here / do this next" thread never
 * breaks, and it reads readiness the #1227 way (empty KBs don't count).
 *
 * Self-fetches its counts; a page that mutates KB/pipeline state can pass a
 * `refreshKey` it bumps so the bar re-syncs without a navigation. */
export function GoldenPathStepper({ refreshKey }: { refreshKey?: unknown }) {
  const { token } = useAuth();
  const journey = useJourney(refreshKey);

  // The golden path is about creating things, which needs a login — nothing to
  // guide an anonymous browser toward, so stay out of the way entirely.
  if (!token) return null;

  const counts: JourneyCounts | null = journey.data;
  const next = primaryAction(counts);

  return (
    <nav
      aria-label="Getting started"
      className={`mb-5 ${cardClass} !p-3.5`}
    >
      <ol className="flex flex-wrap items-center gap-y-2">
        {JOURNEY_STEPS.map((step, i) => {
          const status = stepStatus(counts, i);
          const done = status === "done";
          const current = status === "current";
          return (
            <li key={step.key} className="flex items-center">
              <Link
                to={step.to}
                aria-current={current ? "step" : undefined}
                className={`group flex items-center gap-2 rounded-lg px-2 py-1 transition hover:bg-gray-50 dark:hover:bg-gray-800/60 ${
                  current ? "" : "opacity-80 hover:opacity-100"
                }`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 ring-inset transition ${
                    done
                      ? "bg-indigo-600 text-white ring-indigo-600"
                      : current
                        ? "bg-indigo-50 text-indigo-600 ring-indigo-300 dark:bg-indigo-950/50 dark:text-indigo-300 dark:ring-indigo-700"
                        : "bg-gray-100 text-gray-400 ring-gray-200 dark:bg-gray-800 dark:text-gray-500 dark:ring-gray-700"
                  }`}
                >
                  {done ? <Icon name="check" size={15} /> : <Icon name={step.icon} size={14} />}
                </span>
                <span
                  className={`text-sm font-medium ${
                    current
                      ? "text-gray-900 dark:text-gray-100"
                      : done
                        ? "text-gray-700 dark:text-gray-300"
                        : "text-gray-400 dark:text-gray-500"
                  }`}
                >
                  {step.label}
                </span>
              </Link>
              {i < JOURNEY_STEPS.length - 1 && (
                <Icon
                  name="chevron-right"
                  size={15}
                  className="mx-0.5 shrink-0 text-gray-300 dark:text-gray-600"
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>
      <Link
        to={next.to}
        className="group mt-1.5 flex items-center gap-1.5 px-2 text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
      >
        <span className="text-gray-500 dark:text-gray-400">Next:</span>
        {next.title}
        <Icon name="arrow" size={13} className="transition group-hover:translate-x-0.5" />
      </Link>
    </nav>
  );
}
