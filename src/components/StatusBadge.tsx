import { badgeClass, badgeTone } from "../lib/ui";
import { Icon, type IconName } from "./Icon";

export type StatusTone = keyof typeof badgeTone | "neutral";

/** A status pill -- "Enabled", "Featured", "Inactive" -- in the same text +
 * icon style as SourceBadge (#2193), replacing the emoji badges ("✓ enabled",
 * "⭐ featured") that read inconsistently across screen readers and couldn't
 * follow the theme (#2195).
 *
 * The meaning is always in the text; the tone colour and the icon only
 * reinforce it, so it never relies on colour alone. `srPrefix` adds a
 * visually-hidden qualifier ("Your install: Enabled") where the bare label
 * would be ambiguous out of context. */
export function StatusBadge({
  icon,
  label,
  tone = "neutral",
  srPrefix,
  className,
}: {
  icon: IconName;
  label: string;
  tone?: StatusTone;
  srPrefix?: string;
  className?: string;
}) {
  const toneClass = tone === "neutral" ? "" : ` ${badgeTone[tone]}`;
  return (
    <span
      className={`${badgeClass}${toneClass}${className ? ` ${className}` : ""}`}
      data-status-badge={label}
    >
      {srPrefix && <span className="sr-only">{`${srPrefix}: `}</span>}
      <Icon name={icon} size={12} className="shrink-0" />
      {label}
    </span>
  );
}
