import { forwardRef, type ReactNode } from "react";

import type { RetrievedSource } from "../lib/citations";
import { badgeClass } from "../lib/ui";
import { Icon } from "./Icon";

const SNIPPET_CHARS = 200;

/** The retrieved sources behind an answer, one card each. A card a citation
 * chip points at (#2429) is highlighted and shows its full passage; the
 * others show a snippet. Cards are `${idPrefix}-${index}` so the chips can
 * reference them, and focusable (tabIndex -1) so a click can move focus. */
export function SourceCards({
  sources,
  idPrefix,
  activeSource,
  markersBySource,
  cardRef,
  renderExtra,
}: {
  sources: readonly RetrievedSource[];
  idPrefix: string;
  activeSource?: number | null;
  /** Citation markers that point at each source, for the card's label. */
  markersBySource?: ReadonlyMap<number, number[]>;
  cardRef?: (index: number, el: HTMLLIElement | null) => void;
  /** Extra per-source content (e.g. an "open passage" control). */
  renderExtra?: (source: RetrievedSource, index: number) => ReactNode;
}) {
  return (
    <ul className="flex flex-col gap-1.5">
      {sources.map((s, i) => (
        <SourceCard
          key={i}
          id={`${idPrefix}-${i}`}
          ref={(el) => cardRef?.(i, el)}
          source={s}
          markers={markersBySource?.get(i) ?? []}
          active={activeSource === i}
        >
          {renderExtra?.(s, i)}
        </SourceCard>
      ))}
    </ul>
  );
}

const SourceCard = forwardRef<
  HTMLLIElement,
  {
    id: string;
    source: RetrievedSource;
    markers: number[];
    active: boolean;
    children?: ReactNode;
  }
>(function SourceCard({ id, source, markers, active, children }, ref) {
  const long = source.text.length > SNIPPET_CHARS;
  const label = markers.length ? `Source ${markers.join(", ")}` : "Source";
  return (
    <li
      id={id}
      ref={ref}
      tabIndex={-1}
      aria-label={`${label}: ${source.source}`}
      data-highlighted={active || undefined}
      className={`rounded-md border px-2.5 py-2 text-xs outline-none transition ${
        active
          ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-400/60 dark:border-indigo-600 dark:bg-indigo-950/40"
          : "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
      }`}
    >
      <div className="mb-1 flex flex-wrap items-center gap-1.5 text-gray-700 dark:text-gray-300">
        {markers.map((m) => (
          <span
            key={m}
            className="rounded bg-indigo-100 px-1 font-semibold text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300"
          >
            [{m}]
          </span>
        ))}
        <Icon name="file" size={12} />
        <span className="font-medium">{source.source}</span>
        {source.page != null && <span className={badgeClass}>page {source.page}</span>}
        {source.score != null && (
          <span className="text-gray-400 dark:text-gray-500">
            score {source.score.toFixed(3)}
          </span>
        )}
      </div>
      <p
        className={`whitespace-pre-wrap text-gray-600 dark:text-gray-400 ${
          active ? "max-h-60 overflow-auto" : ""
        }`}
      >
        {active || !long ? source.text : `${source.text.slice(0, SNIPPET_CHARS)}…`}
      </p>
      {children}
    </li>
  );
});
