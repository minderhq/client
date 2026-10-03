import { type SourceKind, SOURCE_META } from "../lib/pluginSource";
import { badgeClass } from "../lib/ui";
import { Icon } from "./Icon";

/** Where a plugin came from -- First-party, Private git, Submitted on this
 * instance (and, from Phase 2, MindHub). The one badge Browse cards, Installed
 * cards and the source-repository view all use (#2193).
 *
 * Text + icon, never colour alone. A visually-hidden "Source:" prefix gives the
 * badge a self-explanatory name ("Source: First-party"), and the meaning of the
 * source follows as visually-hidden text, so a screen reader announces it in
 * place. `title` is only a mouse convenience on top; keyboard and touch users
 * get the same explanations from {@link SourceLegend}. Renders nothing for an
 * unclassified plugin (see `resolveSource`) rather than guessing. */
export function SourceBadge({
  source,
  className,
}: {
  source: SourceKind | null | undefined;
  className?: string;
}) {
  if (!source) return null;
  const meta = SOURCE_META[source];
  return (
    <span
      className={`${badgeClass} ${meta.toneClass}${className ? ` ${className}` : ""}`}
      title={meta.description}
      data-source={source}
    >
      <span className="sr-only">Source: </span>
      <Icon name={meta.icon} size={12} className="shrink-0" />
      {meta.label}
      <span className="sr-only" data-testid="source-description">
        {` (${meta.description})`}
      </span>
    </span>
  );
}

/** "What do the source badges mean?" -- a native disclosure (keyboard- and
 * touch-operable, no hover needed) listing each source's badge and meaning.
 * `kinds` defaults to every source a plugin can currently resolve to. */
export function SourceLegend({
  kinds = ["first_party", "private_git", "submitted"],
  className,
}: {
  kinds?: readonly SourceKind[];
  className?: string;
}) {
  return (
    <details className={`text-xs text-gray-500 dark:text-gray-400${className ? ` ${className}` : ""}`}>
      <summary className="cursor-pointer font-medium text-indigo-600 dark:text-indigo-400">
        What do the source badges mean?
      </summary>
      <dl className="mt-2 grid gap-x-3 gap-y-1.5 sm:grid-cols-[max-content_1fr]">
        {kinds.map((kind) => {
          const meta = SOURCE_META[kind];
          return (
            <div key={kind} className="contents">
              <dt className="flex items-center gap-1 font-medium text-gray-700 dark:text-gray-300">
                <Icon name={meta.icon} size={12} className="shrink-0" />
                {meta.label}
              </dt>
              <dd>{meta.description}</dd>
            </div>
          );
        })}
      </dl>
    </details>
  );
}
