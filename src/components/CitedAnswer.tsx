import { useMemo } from "react";

import {
  citationLabel,
  parseCitedAnswer,
  type Citation,
  type RetrievedSource,
} from "../lib/citations";

/** An answer whose `[n]` markers (#2429) render as superscript citation chips.
 * Only markers listed in `citations` become chips; unknown markers, markdown
 * links and anything inside code stay plain text. Without `onCite` (or with
 * no citations) the answer renders exactly as plain text.
 *
 * Security: assistant text is model output and must stay inert. Never add a
 * markdown/HTML renderer here (no rehype-raw, no dangerouslySetInnerHTML):
 * a markdown image would make the browser fetch an attacker-chosen URL with
 * no click. If markdown is ever wanted, block remote images and give links
 * rel="noopener noreferrer nofollow". CitedAnswer.test.tsx pins this. */
export function CitedAnswer({
  answer,
  sources,
  citations,
  sourceIdPrefix,
  activeSource,
  onCite,
}: {
  answer: string;
  sources: readonly RetrievedSource[];
  citations?: readonly Citation[] | null;
  /** Source card ids are `${sourceIdPrefix}-${index}` (for aria-controls). */
  sourceIdPrefix?: string;
  activeSource?: number | null;
  onCite?: (sourceIndex: number) => void;
}) {
  const segments = useMemo(
    () => (onCite ? parseCitedAnswer(answer, citations, sources.length) : null),
    [answer, citations, sources.length, onCite],
  );

  return (
    <p className="whitespace-pre-wrap">
      {segments === null
        ? answer
        : segments.map((seg, i) =>
            seg.kind === "text" ? (
              seg.text
            ) : (
              <sup key={i} className="mx-px">
                <button
                  type="button"
                  onClick={() => onCite?.(seg.sourceIndex)}
                  aria-label={citationLabel(seg.marker, sources[seg.sourceIndex])}
                  title={citationLabel(seg.marker, sources[seg.sourceIndex])}
                  aria-controls={
                    sourceIdPrefix ? `${sourceIdPrefix}-${seg.sourceIndex}` : undefined
                  }
                  aria-pressed={activeSource === seg.sourceIndex}
                  data-citation={seg.marker}
                  className={`inline-flex min-w-[1.25rem] items-center justify-center rounded px-1 text-[0.7rem] font-semibold leading-4 outline-none transition focus-visible:ring-2 focus-visible:ring-indigo-500/70 ${
                    activeSource === seg.sourceIndex
                      ? "bg-indigo-600 text-white"
                      : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:text-indigo-300 dark:hover:bg-indigo-900"
                  }`}
                >
                  {seg.marker}
                </button>
              </sup>
            ),
          )}
    </p>
  );
}
