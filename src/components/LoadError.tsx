import type { ReactNode } from "react";

import { ghostButtonClass, secondaryButtonClass } from "../lib/ui";
import { Icon } from "./Icon";

/** A failed load the user can recover from: what failed, why, and a Retry
 * button -- instead of an empty `catch {}` that makes a broken backend look
 * like "nothing here" (#2195).
 *
 * Two weights:
 * - default: the page's main content didn't load. A tinted alert box in place
 *   of the list, announced assertively (`role="alert"`).
 * - `quiet`: a secondary section (featured, recommendations) didn't load. One
 *   muted line, announced politely (`role="status"`), so the main list below
 *   stays the focus and stays usable.
 *
 * `what` completes the button's accessible name ("Retry loading featured
 * plugins") -- several notices can share a page, and a list of identical
 * "Retry" buttons is ambiguous. The visible text stays "Retry", which the
 * accessible name starts with (WCAG 2.5.3, label in name). */
export function LoadError({
  title,
  message,
  onRetry,
  what,
  quiet = false,
  className,
}: {
  /** What couldn't be loaded, as a sentence ("Couldn't load the plugin catalog."). */
  title: ReactNode;
  /** The underlying reason (friendlyErrorMessage), when there is one. */
  message?: string | null;
  onRetry: () => void;
  /** What a retry reloads, completing "Retry loading …" for assistive tech. */
  what: string;
  quiet?: boolean;
  className?: string;
}) {
  const retry = (
    <button
      type="button"
      onClick={onRetry}
      className={quiet ? `${ghostButtonClass} px-2 py-1 text-xs` : secondaryButtonClass}
    >
      <Icon name="reset" size={quiet ? 13 : 15} />
      Retry<span className="sr-only">{` loading ${what}`}</span>
    </button>
  );

  if (quiet) {
    return (
      <div
        role="status"
        className={`mb-4 flex flex-wrap items-center gap-x-2 text-xs text-gray-600 dark:text-gray-400${className ? ` ${className}` : ""}`}
      >
        <Icon name="warning" size={13} className="shrink-0 text-amber-500 dark:text-amber-400" />
        <span>
          {title}
          {message && <> ({message})</>}
        </span>
        {retry}
      </div>
    );
  }

  return (
    <div
      role="alert"
      className={`mb-4 flex flex-wrap items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/60 dark:text-red-100${className ? ` ${className}` : ""}`}
    >
      <Icon name="warning" size={17} className="mt-0.5 shrink-0 text-red-500 dark:text-red-400" />
      <div className="min-w-0 flex-1 leading-relaxed">
        <p className="font-medium">{title}</p>
        {message && <p className="mt-0.5">{message}</p>}
      </div>
      {retry}
    </div>
  );
}
