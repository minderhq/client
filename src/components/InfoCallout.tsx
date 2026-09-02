import type { ReactNode } from "react";

import { Icon, type IconName } from "./Icon";

export type CalloutTone = "info" | "warn" | "danger";

const TONE_CLASS: Record<CalloutTone, string> = {
  info: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/60 dark:text-sky-100",
  warn: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100",
  danger:
    "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/60 dark:text-red-100",
};

const TONE_ICON_CLASS: Record<CalloutTone, string> = {
  info: "text-sky-500 dark:text-sky-400",
  warn: "text-amber-500 dark:text-amber-400",
  danger: "text-red-500 dark:text-red-400",
};

/** A small tinted callout box for a clarifying note -- distinct from a plain
 * paragraph so it reads as "important context," not body copy. The icon now
 * comes from the shared registry (crisp SVG, inherits color) rather than an
 * emoji. When `tone` is not given it's inferred from the icon — a `warning`
 * icon paints the box amber — so most call sites need only pass the icon. */
export function InfoCallout({
  icon = "info",
  tone,
  children,
}: {
  icon?: IconName;
  tone?: CalloutTone;
  children: ReactNode;
}) {
  const resolved: CalloutTone = tone ?? (icon === "warning" ? "warn" : "info");
  return (
    <div
      className={`flex gap-2.5 rounded-xl border p-3.5 text-sm ${TONE_CLASS[resolved]}`}
    >
      <Icon
        name={icon}
        size={17}
        className={`mt-0.5 shrink-0 ${TONE_ICON_CLASS[resolved]}`}
      />
      <div className="min-w-0 leading-relaxed">{children}</div>
    </div>
  );
}
