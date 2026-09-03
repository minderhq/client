import { apiFetch } from "./api";
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
