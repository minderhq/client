import { describe, expect, it } from "vitest";

import { codeRanges, parseCitedAnswer, type Citation } from "./citations";

const cites = (...markers: number[]): Citation[] =>
  markers.map((m) => ({ marker: m, source_index: m - 1, chunk_id: `c${m}` }));

describe("parseCitedAnswer", () => {
  it("turns listed markers into citation segments", () => {
    expect(parseCitedAnswer("Paris is the capital [1].", cites(1), 1)).toEqual([
      { kind: "text", text: "Paris is the capital " },
      { kind: "citation", marker: 1, sourceIndex: 0 },
      { kind: "text", text: "." },
    ]);
  });

  it("splits adjacent markers into separate citations", () => {
    expect(parseCitedAnswer("Both say so [1][2]", cites(1, 2), 2)).toEqual([
      { kind: "text", text: "Both say so " },
      { kind: "citation", marker: 1, sourceIndex: 0 },
      { kind: "citation", marker: 2, sourceIndex: 1 },
    ]);
  });

  it("leaves markers that are not in citations as plain text", () => {
    expect(parseCitedAnswer("Known [1], unknown [7].", cites(1), 1)).toEqual([
      { kind: "text", text: "Known " },
      { kind: "citation", marker: 1, sourceIndex: 0 },
      { kind: "text", text: ", unknown [7]." },
    ]);
  });

  it("ignores a citation whose source_index is out of range", () => {
    const bad: Citation[] = [{ marker: 1, source_index: 3 }];
    expect(parseCitedAnswer("See [1].", bad, 1)).toEqual([{ kind: "text", text: "See [1]." }]);
  });

  it("is all plain text when citations are empty (compression ran)", () => {
    expect(parseCitedAnswer("Summary [1].", [], 2)).toEqual([
      { kind: "text", text: "Summary [1]." },
    ]);
    expect(parseCitedAnswer("Summary [1].", undefined, 2)).toEqual([
      { kind: "text", text: "Summary [1]." },
    ]);
  });

  it("does not treat markdown links or reference definitions as markers", () => {
    const answer = "See [5](https://example.com/x) then [5].\n[5]: https://e.com";
    expect(parseCitedAnswer(answer, cites(5).map((c) => ({ ...c, source_index: 0 })), 1)).toEqual([
      { kind: "text", text: "See [5](https://example.com/x) then " },
      { kind: "citation", marker: 5, sourceIndex: 0 },
      { kind: "text", text: ".\n[5]: https://e.com" },
    ]);
  });

  it("never parses markers inside inline code spans", () => {
    expect(parseCitedAnswer("Use `arr[1]` and ``x[1]`` per [1]", cites(1), 1)).toEqual([
      { kind: "text", text: "Use `arr[1]` and ``x[1]`` per " },
      { kind: "citation", marker: 1, sourceIndex: 0 },
    ]);
  });

  it("treats an unclosed backtick as literal text", () => {
    expect(parseCitedAnswer("a ` b [1]", cites(1), 1)).toEqual([
      { kind: "text", text: "a ` b " },
      { kind: "citation", marker: 1, sourceIndex: 0 },
    ]);
  });

  it("never parses markers inside fenced code blocks", () => {
    const answer = "Run this [1]:\n```py\nx = a[1]\n```\nand\n~~~\nb[2]\n~~~\ndone [2]";
    const segs = parseCitedAnswer(answer, cites(1, 2), 2);
    expect(segs.filter((s) => s.kind === "citation")).toEqual([
      { kind: "citation", marker: 1, sourceIndex: 0 },
      { kind: "citation", marker: 2, sourceIndex: 1 },
    ]);
    expect(segs.map((s) => (s.kind === "text" ? s.text : `<${s.marker}>`)).join("")).toBe(
      answer.replace("this [1]", "this <1>").replace("done [2]", "done <2>"),
    );
  });

  it("treats an unclosed fence as code to the end", () => {
    expect(parseCitedAnswer("ok [1]\n```\ncode [1]", cites(1), 1)).toEqual([
      { kind: "text", text: "ok " },
      { kind: "citation", marker: 1, sourceIndex: 0 },
      { kind: "text", text: "\n```\ncode [1]" },
    ]);
  });

  it("handles the public chat citation shape (no chunk_id)", () => {
    const publicCites: Citation[] = [{ marker: 1, source_index: 0 }];
    expect(parseCitedAnswer("Yes [1]", publicCites, 1)).toEqual([
      { kind: "text", text: "Yes " },
      { kind: "citation", marker: 1, sourceIndex: 0 },
    ]);
  });
});

describe("codeRanges", () => {
  it("finds inline spans and fences", () => {
    const text = "a `b` c\n```\nd\n```\ne";
    expect(codeRanges(text)).toEqual([
      [2, 5],
      [8, 17],
    ]);
  });
});
