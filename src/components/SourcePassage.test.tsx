import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import type { RetrievedSource } from "../lib/citations";
import {
  chunkHighlightRange,
  codePointToUtf16Index,
  fetchDocumentChunks,
  findSourceChunk,
  type ChunkInfo,
} from "../lib/ragDocuments";
import { QueryResultCard, type QueryResponse } from "../pages/RagPipelinesPage";

const apiFetch = vi.fn();
vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

afterEach(() => {
  cleanup();
  apiFetch.mockReset();
});

const chunks: ChunkInfo[] = [
  { chunk_index: 0, text: "Intro text.", chunk_id: "c0", page: 1, char_start: 0, char_end: 11 },
  {
    chunk_index: 1,
    text: "Refunds are allowed within 30 days.",
    chunk_id: "c1",
    page: 2,
    char_start: 12,
    char_end: 47,
  },
  { chunk_index: 2, text: "Shipping is free.", chunk_id: "c2", page: 2, char_start: 48, char_end: 65 },
];

describe("chunk helpers", () => {
  it("finds a chunk by chunk_id first, then chunk_index", () => {
    expect(findSourceChunk(chunks, { chunk_id: "c2", chunk_index: 0 })).toBe(2);
    expect(findSourceChunk(chunks, { chunk_id: "gone", chunk_index: 1 })).toBe(1);
    expect(findSourceChunk(chunks, { chunk_index: 1 })).toBe(1);
    expect(findSourceChunk(chunks, { chunk_id: null, chunk_index: null })).toBe(-1);
  });

  it("maps a document span into the chunk, clamped", () => {
    expect(chunkHighlightRange(chunks[1], { char_start: 24, char_end: 47 })).toEqual([12, 35]);
    expect(chunkHighlightRange(chunks[1], { char_start: 0, char_end: 999 })).toEqual([0, 35]);
    expect(chunkHighlightRange(chunks[1], { char_start: 100, char_end: 120 })).toBeNull();
    expect(chunkHighlightRange(chunks[1], { char_start: null, char_end: 20 })).toBeNull();
    expect(chunkHighlightRange({ chunk_index: 1, text: "x" }, { char_start: 0, char_end: 1 })).toBeNull();
  });

  it("treats offsets as code points, so an emoji before the span doesn't shift it", () => {
    // "😀" is one code point but two UTF-16 units.
    const chunk: ChunkInfo = { chunk_index: 0, text: "😀 Refunds 💸 in 30 days.", char_start: 100 };
    expect(codePointToUtf16Index(chunk.text, 2)).toBe(3);
    // Code points: "😀"=0, " "=1, "Refunds"=2..8, " "=9, "💸"=10, " "=11, "in"=12..13
    const range = chunkHighlightRange(chunk, { char_start: 102, char_end: 109 })!;
    expect(chunk.text.slice(...range)).toBe("Refunds");
    const emoji = chunkHighlightRange(chunk, { char_start: 110, char_end: 111 })!;
    expect(chunk.text.slice(...emoji)).toBe("💸");
    expect(chunk.text.slice(emoji[1])).toBe(" in 30 days.");
  });

  it("URL-encodes ids so one containing / or ? stays a single path segment", async () => {
    apiFetch.mockResolvedValueOnce({ items: [] });
    await fetchDocumentChunks(["kb/1"], "doc?x=1/../2", "tok");
    expect(apiFetch.mock.calls[0][0]).toBe(
      "/v1/rag/knowledge-bases/kb%2F1/documents/doc%3Fx%3D1%2F..%2F2/chunks?limit=500",
    );
  });

  it("tries each knowledge base until one has the document", async () => {
    apiFetch
      .mockRejectedValueOnce(new ApiError("not found", 404))
      .mockResolvedValueOnce({ items: chunks });
    await expect(fetchDocumentChunks(["kb-a", "kb-b"], "doc-1", "tok")).resolves.toEqual(chunks);
    expect(apiFetch.mock.calls.map((c) => c[0])).toEqual([
      "/v1/rag/knowledge-bases/kb-a/documents/doc-1/chunks?limit=500",
      "/v1/rag/knowledge-bases/kb-b/documents/doc-1/chunks?limit=500",
    ]);
  });

  it("returns null when no knowledge base has it, and rethrows other errors", async () => {
    apiFetch.mockRejectedValue(new ApiError("not found", 404));
    await expect(fetchDocumentChunks(["kb-a"], "doc-1", "tok")).resolves.toBeNull();
    apiFetch.mockRejectedValue(new ApiError("boom", 500));
    await expect(fetchDocumentChunks(["kb-a"], "doc-1", "tok")).rejects.toThrow("boom");
  });
});

const source: RetrievedSource = {
  text: "Refunds are allowed within 30 days.",
  source: "handbook.pdf",
  score: 0.9,
  chunk_id: "c1",
  chunk_index: 1,
  document_id: "doc-1",
  page: 2,
  char_start: 32, // "within 30 days." in chunk c1 (which starts at 12)
  char_end: 47,
};

function response(sources: RetrievedSource[]): QueryResponse {
  return {
    answer: "Thirty days [1].",
    sources,
    citations: [{ marker: 1, source_index: 0, chunk_id: "c1" }],
    confidence: 0.9,
    model_used: "llama3",
    method: "standard",
  };
}

describe("Open passage", () => {
  it("loads the document's chunks and highlights the cited span in context", async () => {
    apiFetch.mockResolvedValueOnce({ items: chunks });
    render(<QueryResultCard response={response([source])} kbIds={["kb-a"]} token="tok" />);

    const toggle = screen.getByRole("button", { name: "Open passage" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);

    const mark = await screen.findByText("within 30 days.");
    expect(mark.tagName).toBe("MARK");
    const matched = mark.closest("[data-matched]") as HTMLElement;
    expect(within(matched).getByText("page 2")).toBeTruthy();
    // Neighbouring chunks give context, unhighlighted.
    expect(screen.getByText("Intro text.").tagName).not.toBe("MARK");
    expect(screen.getByText("Shipping is free.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide passage" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/rag/knowledge-bases/kb-a/documents/doc-1/chunks?limit=500",
      expect.objectContaining({ token: "tok" }),
    );
  });

  it("highlights the whole chunk when offsets are missing", async () => {
    apiFetch.mockResolvedValueOnce({ items: chunks.map((c) => ({ ...c, char_start: null })) });
    render(<QueryResultCard response={response([source])} kbIds={["kb-a"]} token="tok" />);
    fireEvent.click(screen.getByRole("button", { name: "Open passage" }));
    const mark = await screen.findByText("Refunds are allowed within 30 days.", { selector: "mark" });
    expect(mark).toBeTruthy();
  });

  it("says so when the chunk is no longer in the document", async () => {
    apiFetch.mockResolvedValueOnce({ items: [chunks[0]] });
    render(<QueryResultCard response={response([source])} kbIds={["kb-a"]} token="tok" />);
    fireEvent.click(screen.getByRole("button", { name: "Open passage" }));
    expect(await screen.findByText(/couldn't be found in the document/)).toBeTruthy();
  });

  it("is not offered without provenance ids (public chat shape) or without a token", () => {
    const publicSource: RetrievedSource = {
      text: source.text,
      source: source.source,
      score: source.score,
      page: source.page,
      char_start: source.char_start,
      char_end: source.char_end,
    };
    const { rerender } = render(
      <QueryResultCard response={response([publicSource])} kbIds={["kb-a"]} token="tok" />,
    );
    expect(screen.queryByRole("button", { name: "Open passage" })).toBeNull();
    rerender(<QueryResultCard response={response([source])} />);
    expect(screen.queryByRole("button", { name: "Open passage" })).toBeNull();
  });
});
