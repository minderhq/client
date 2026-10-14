/**
 * Clickable citations with chunk provenance (#2429).
 *
 * The query endpoint normalises the answer's citation markers to `[n]`
 * (adjacent ones as `[1][2]`) and returns `citations[]`: one entry per
 * distinct marker, in order of first use, mapping marker n to
 * `sources[source_index]`. This module turns an answer into text and citation
 * segments; only markers the server listed in `citations` become citations,
 * and nothing inside a code span or fenced code block is ever one.
 */

/** One retrieved passage behind an answer. Every provenance field is optional:
 * older backends omit them, and the public chat drops `document_id` and
 * `chunk_id`. Extra properties are allowed by the backend contract. */
export interface RetrievedSource {
  /** The passage given to the model. For parent-context retrieval this is the
   * parent passage; the provenance fields below describe the matched child. */
  text: string;
  /** The filename. */
  source: string;
  score?: number | null;
  chunk_id?: string | null;
  chunk_index?: number | null;
  document_id?: string | null;
  /** 1-based PDF page, PPTX slide or DOCX page. */
  page?: number | null;
  /** Span in the document's extracted text (end exclusive). */
  char_start?: number | null;
  char_end?: number | null;
  /** "parent" when `text` is the parent passage of the matched chunk. */
  context_type?: string | null;
  child_chunk_index?: number | null;
  rerank_score?: number | null;
}

/** One distinct `[marker]` used in the answer. `source_index` is 0-based into
 * `sources`. The public chat sends `{marker, source_index}` only. */
export interface Citation {
  marker: number;
  source_index: number;
  chunk_id?: string | null;
}

export type AnswerSegment =
  | { kind: "text"; text: string }
  | { kind: "citation"; marker: number; sourceIndex: number };

/** Half-open [start, end) ranges of `text` that are code: fenced blocks
 * (``` or ~~~, closed by a fence of the same character at least as long, or
 * running to the end) and inline code spans (a backtick run closed by a run of
 * exactly the same length; an unclosed run is literal text). */
export function codeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const fenceOpen = /^ {0,3}(`{3,}|~{3,})/;
  let pos = 0;
  // Fenced blocks first, line by line.
  const lines: Array<{ start: number; text: string }> = [];
  for (const line of text.split("\n")) {
    lines.push({ start: pos, text: line });
    pos += line.length + 1;
  }
  const fenced: Array<[number, number]> = [];
  for (let i = 0; i < lines.length; i++) {
    const open = fenceOpen.exec(lines[i].text);
    if (!open) continue;
    const char = open[1][0];
    const len = open[1].length;
    // A backtick fence's info string may not contain backticks.
    if (char === "`" && lines[i].text.slice(open[0].length).includes("`")) continue;
    let end = text.length;
    let j = i + 1;
    for (; j < lines.length; j++) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(lines[j].text);
      if (close && close[1][0] === char && close[1].length >= len) {
        end = Math.min(text.length, lines[j].start + lines[j].text.length);
        break;
      }
    }
    fenced.push([lines[i].start, end]);
    i = j;
  }

  // Inline code spans in the text between fenced blocks.
  let cursor = 0;
  const gaps: Array<[number, number]> = [];
  for (const [s, e] of fenced) {
    gaps.push([cursor, s]);
    cursor = e;
  }
  gaps.push([cursor, text.length]);
  for (const [gs, ge] of gaps) {
    const run = /`+/g;
    run.lastIndex = gs;
    const segment = text.slice(0, ge);
    let m: RegExpExecArray | null;
    while ((m = run.exec(segment)) !== null) {
      const ticks = m[0];
      const closeRe = /`+/g;
      closeRe.lastIndex = m.index + ticks.length;
      let close: RegExpExecArray | null;
      let closedAt = -1;
      while ((close = closeRe.exec(segment)) !== null) {
        if (close[0].length === ticks.length) {
          closedAt = close.index + close[0].length;
          break;
        }
      }
      if (closedAt === -1) continue; // unclosed: literal backticks
      ranges.push([m.index, closedAt]);
      run.lastIndex = closedAt;
    }
  }
  ranges.push(...fenced);
  return ranges.sort((a, b) => a[0] - b[0]);
}

/** `[n]` not immediately followed by `(` (a markdown link like `[5](https://…)`). */
const MARKER = /\[(\d{1,4})\](?!\()/g;

/** A link reference definition (`[5]: https://…`) at the start of a line. */
function isReferenceDefinition(text: string, index: number, length: number): boolean {
  if (text[index + length] !== ":") return false;
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  return /^ {0,3}$/.test(text.slice(lineStart, index));
}

/** Splits `answer` into text and citation segments. A marker becomes a
 * citation only when it appears in `citations` and its `source_index` points at
 * one of the `sourceCount` sources; anything else (an unknown marker, a link, a
 * marker inside code) stays plain text. Adjacent text is merged. */
export function parseCitedAnswer(
  answer: string,
  citations: readonly Citation[] | null | undefined,
  sourceCount: number,
): AnswerSegment[] {
  const byMarker = new Map<number, number>();
  for (const c of citations ?? []) {
    if (Number.isInteger(c.source_index) && c.source_index >= 0 && c.source_index < sourceCount) {
      byMarker.set(c.marker, c.source_index);
    }
  }
  if (byMarker.size === 0) return answer ? [{ kind: "text", text: answer }] : [];

  const code = codeRanges(answer);
  const inCode = (i: number) => code.some(([s, e]) => i >= s && i < e);

  const segments: AnswerSegment[] = [];
  const pushText = (text: string) => {
    if (!text) return;
    const last = segments[segments.length - 1];
    if (last?.kind === "text") last.text += text;
    else segments.push({ kind: "text", text });
  };

  let last = 0;
  for (const m of answer.matchAll(MARKER)) {
    const index = m.index ?? 0;
    const marker = Number(m[1]);
    const sourceIndex = byMarker.get(marker);
    if (sourceIndex === undefined || inCode(index)) continue;
    if (isReferenceDefinition(answer, index, m[0].length)) continue;
    pushText(answer.slice(last, index));
    segments.push({ kind: "citation", marker, sourceIndex });
    last = index + m[0].length;
  }
  pushText(answer.slice(last));
  return segments;
}

/** Accessible name of a citation chip: "Source 2: handbook.pdf, page 4". */
export function citationLabel(marker: number, source: RetrievedSource | undefined): string {
  if (!source) return `Source ${marker}`;
  const page = source.page != null ? `, page ${source.page}` : "";
  return `Source ${marker}: ${source.source}${page}`;
}

/** True when a source carries enough provenance to locate its chunk (never
 * for the public chat, which drops document_id and chunk_id). */
export function canOpenPassage(source: RetrievedSource): boolean {
  return Boolean(source.document_id) && (source.chunk_id != null || source.chunk_index != null);
}
