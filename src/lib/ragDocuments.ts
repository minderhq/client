import { ApiError, apiFetch } from "./api";
import type { Paginated } from "./api";

/** One uploaded document, for the query "scope to a single document" picker. */
export interface ScopeDocument {
  document_id: string;
  filename: string;
}

/** Flatten several per-KB document lists into one, deduped by document_id and
 * keeping first-seen order — the same file can live in more than one KB a
 * pipeline covers, and entries missing a document_id are dropped. Pure (no I/O)
 * so the dedup rule is unit-testable independently of the fetch. */
export function dedupeScopeDocuments(lists: ScopeDocument[][]): ScopeDocument[] {
  const seen = new Set<string>();
  const out: ScopeDocument[] = [];
  for (const list of lists) {
    for (const d of list) {
      if (d.document_id && !seen.has(d.document_id)) {
        seen.add(d.document_id);
        out.push({ document_id: d.document_id, filename: d.filename });
      }
    }
  }
  return out;
}

/** All documents across a pipeline's knowledge bases, for the query
 * "scope to one document" picker (`metadata_filter.document_id`). Best-effort
 * per KB (a KB whose list fails contributes nothing rather than failing the
 * whole picker) and deduped by document_id, since the same file can live in
 * more than one KB a pipeline covers. JWT-gated, so the token is required. */
export async function fetchScopeDocuments(
  kbIds: string[],
  token: string,
  signal?: AbortSignal,
): Promise<ScopeDocument[]> {
  const lists = await Promise.all(
    kbIds.map((kb) =>
      apiFetch<Paginated<ScopeDocument>>(
        `/v1/rag/knowledge-bases/${kb}/documents`,
        { token, signal },
      )
        .then((r) => r.items ?? [])
        .catch(() => [] as ScopeDocument[]),
    ),
  );
  return dedupeScopeDocuments(lists);
}

/** One stored chunk of a document (GET .../documents/{id}/chunks). The
 * provenance fields (#2429) are absent on older backends. */
export interface ChunkInfo {
  chunk_index: number;
  text: string;
  chunk_id?: string | null;
  /** 1-based PDF page, PPTX slide or DOCX page. */
  page?: number | null;
  /** Span in the document's extracted text (end exclusive). */
  char_start?: number | null;
  char_end?: number | null;
}

/** The max page size the chunks endpoint allows. */
export const CHUNK_PAGE_LIMIT = 500;

/** A document's chunks, from the first of `kbIds` that holds it. A source
 * carries its `document_id` but not its knowledge base, so each of the
 * pipeline's KBs is tried in order; null when none has the document. Any
 * error other than a 404 is thrown. */
export async function fetchDocumentChunks(
  kbIds: readonly string[],
  documentId: string,
  token: string,
  signal?: AbortSignal,
): Promise<ChunkInfo[] | null> {
  for (const kb of kbIds) {
    try {
      const res = await apiFetch<Paginated<ChunkInfo>>(
        `/v1/rag/knowledge-bases/${kb}/documents/${documentId}/chunks?limit=${CHUNK_PAGE_LIMIT}`,
        { token, signal },
      );
      return res.items ?? [];
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) continue;
      throw e;
    }
  }
  return null;
}

/** Index into `chunks` of the chunk a source points at: by `chunk_id` when
 * both sides have one, else by `chunk_index`; -1 when absent. */
export function findSourceChunk(
  chunks: readonly ChunkInfo[],
  ref: { chunk_id?: string | null; chunk_index?: number | null },
): number {
  if (ref.chunk_id) {
    const byId = chunks.findIndex((c) => c.chunk_id === ref.chunk_id);
    if (byId !== -1) return byId;
  }
  if (ref.chunk_index != null) {
    return chunks.findIndex((c) => c.chunk_index === ref.chunk_index);
  }
  return -1;
}

/** The part of `chunk.text` to highlight for a source span given in document
 * offsets, as [start, end) within the chunk; null when either side lacks
 * offsets or the span doesn't overlap the chunk (highlight the whole chunk). */
export function chunkHighlightRange(
  chunk: ChunkInfo,
  span: { char_start?: number | null; char_end?: number | null },
): [number, number] | null {
  if (chunk.char_start == null || span.char_start == null || span.char_end == null) {
    return null;
  }
  const start = Math.max(0, span.char_start - chunk.char_start);
  const end = Math.min(chunk.text.length, span.char_end - chunk.char_start);
  return end > start ? [start, end] : null;
}
