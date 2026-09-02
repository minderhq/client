import type { ReactNode } from "react";

import { Icon, type IconName } from "./Icon";

/** Every leaf page's own title. A specific title per page ("RAG Pipelines",
 * not "RAG") is the point: landing on a deep link should tell you exactly
 * what page you're on without checking which sidebar item is highlighted.
 *
 * The icon now renders from the shared registry (crisp SVG in a tinted accent
 * tile) instead of a bare emoji, so it matches the sidebar/command-palette
 * icon for the same concept. `subtitle` folds the one-line description most
 * pages rendered as a separate `<p>` into the header block, and `actions`
 * hosts page-level buttons (refresh, create) aligned to the title row. */
export function PageHeader({
  icon,
  title,
  subtitle,
  actions,
}: {
  icon: IconName;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-start gap-3.5">
      <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100 dark:bg-indigo-950/50 dark:text-indigo-300 dark:ring-indigo-900">
        <Icon name={icon} size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
