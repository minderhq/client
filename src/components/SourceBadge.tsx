import { type SourceKind, SOURCE_META } from "../lib/pluginSource";
import { badgeClass } from "../lib/ui";
import { Icon } from "./Icon";

/** Where a plugin came from -- First-party, Private git, Submitted on this
 * instance (and, from Phase 2, MindHub). The one badge Browse cards, Installed
 * cards and the source-repository view all use (#2193).
 *
 * Text + icon, never colour alone; the visually-hidden "Source:" prefix gives
 * the badge a self-explanatory accessible name ("Source: First-party") and the
 * tooltip says what the source means. Renders nothing for an unclassified
 * plugin (see `resolveSource`) rather than guessing. */
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
    </span>
  );
}
