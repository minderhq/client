import { describe, expect, it } from "vitest";

import { dedupeScopeDocuments, type ScopeDocument } from "./ragDocuments";

const doc = (id: string, filename = `${id}.pdf`): ScopeDocument => ({
  document_id: id,
  filename,
});

describe("dedupeScopeDocuments", () => {
  it("flattens per-KB lists into one", () => {
    expect(dedupeScopeDocuments([[doc("a")], [doc("b")]])).toEqual([
      doc("a"),
      doc("b"),
    ]);
  });

  it("dedupes the same document_id across KBs, keeping the first occurrence", () => {
    // same file shared by two KBs a pipeline covers -- the first KB's filename wins.
    const out = dedupeScopeDocuments([
      [doc("shared", "first.pdf")],
      [doc("shared", "second.pdf"), doc("only-b")],
    ]);
    expect(out).toEqual([doc("shared", "first.pdf"), doc("only-b")]);
  });

  it("preserves first-seen order", () => {
    const out = dedupeScopeDocuments([[doc("c"), doc("a")], [doc("b"), doc("a")]]);
    expect(out.map((d) => d.document_id)).toEqual(["c", "a", "b"]);
  });

  it("drops entries missing a document_id", () => {
    const out = dedupeScopeDocuments([
      [{ document_id: "", filename: "no-id.pdf" }, doc("real")],
    ]);
    expect(out).toEqual([doc("real")]);
  });

  it("handles empty and all-empty input", () => {
    expect(dedupeScopeDocuments([])).toEqual([]);
    expect(dedupeScopeDocuments([[], []])).toEqual([]);
  });
});
