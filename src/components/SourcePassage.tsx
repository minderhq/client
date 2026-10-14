import { useEffect, useId, useRef, useState } from "react";

import { friendlyErrorMessage } from "../lib/api";
import type { RetrievedSource } from "../lib/citations";
import {
  chunkHighlightRange,
  fetchDocumentChunks,
  findSourceChunk,
  CHUNK_PAGE_LIMIT,
  type ChunkInfo,
} from "../lib/ragDocuments";
import { badgeClass } from "../lib/ui";

type State =
  | { status: "idle" | "loading" }
  | { status: "error"; message: string }
  | { status: "missing" }
  | { status: "loaded"; chunks: ChunkInfo[]; match: number };

/** "Open passage" for a cited source (#2429): fetches the document's chunks
 * (from whichever of the pipeline's knowledge bases holds it), and shows the
 * matched chunk between its neighbours, highlighting the source's
 * char_start/char_end span within it when both sides carry offsets (else the
 * whole chunk). For parent-context retrieval the provenance is the matched
 * child chunk, so that is what gets highlighted. */
export function SourcePassage({
  source,
  kbIds,
  token,
}: {
  source: RetrievedSource;
  kbIds: readonly string[];
  token: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ status: "idle" });
  const panelId = useId();
  const markRef = useRef<HTMLElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (open && state.status === "loaded") {
      markRef.current?.scrollIntoView?.({ block: "nearest" });
    }
  }, [open, state.status]);

  async function load() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: "loading" });
    try {
      const chunks = await fetchDocumentChunks(
        kbIds,
        source.document_id as string,
        token,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const match = chunks ? findSourceChunk(chunks, source) : -1;
      setState(chunks && match !== -1 ? { status: "loaded", chunks, match } : { status: "missing" });
    } catch (e) {
      if (controller.signal.aborted) return;
      setState({ status: "error", message: friendlyErrorMessage(e) });
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && (state.status === "idle" || state.status === "error")) void load();
  }

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
      >
        {open ? "Hide passage" : "Open passage"}
      </button>
      {open && (
        <div id={panelId} className="mt-1.5" aria-live="polite">
          {state.status === "loading" && (
            <p className="text-xs text-gray-500 dark:text-gray-400">Loading passage…</p>
          )}
          {state.status === "error" && (
            <p className="text-xs text-red-600 dark:text-red-400">{state.message}</p>
          )}
          {state.status === "missing" && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              This passage couldn't be found in the document
              {source.chunk_index != null && source.chunk_index >= CHUNK_PAGE_LIMIT
                ? ` (only the first ${CHUNK_PAGE_LIMIT} chunks can be shown)`
                : " (it may have been re-ingested or removed)"}
              .
            </p>
          )}
          {state.status === "loaded" && (
            <div className="max-h-72 overflow-auto rounded-md border border-gray-200 bg-white p-2 dark:border-gray-800 dark:bg-gray-950">
              {[state.match - 1, state.match, state.match + 1]
                .filter((i) => i >= 0 && i < state.chunks.length)
                .map((i) => {
                  const chunk = state.chunks[i];
                  const matched = i === state.match;
                  return (
                    <div
                      key={chunk.chunk_index}
                      data-matched={matched || undefined}
                      className={`text-xs ${matched ? "text-gray-800 dark:text-gray-200" : "text-gray-400 dark:text-gray-500"}`}
                    >
                      {matched && (
                        <div className="mb-0.5 flex items-center gap-1.5 font-mono text-gray-400 dark:text-gray-500">
                          #{chunk.chunk_index}
                          {chunk.page != null && <span className={badgeClass}>page {chunk.page}</span>}
                        </div>
                      )}
                      <p className="mb-1.5 whitespace-pre-wrap">
                        {matched ? (
                          <Highlighted chunk={chunk} source={source} markRef={markRef} />
                        ) : (
                          chunk.text
                        )}
                      </p>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const markClass = "rounded-sm bg-amber-200 px-0.5 text-gray-900 dark:bg-amber-500/40 dark:text-gray-100";

function Highlighted({
  chunk,
  source,
  markRef,
}: {
  chunk: ChunkInfo;
  source: RetrievedSource;
  markRef: React.Ref<HTMLElement>;
}) {
  const range = chunkHighlightRange(chunk, source);
  if (!range) {
    return (
      <mark ref={markRef} className={markClass}>
        {chunk.text}
      </mark>
    );
  }
  const [start, end] = range;
  return (
    <>
      {chunk.text.slice(0, start)}
      <mark ref={markRef} className={markClass}>
        {chunk.text.slice(start, end)}
      </mark>
      {chunk.text.slice(end)}
    </>
  );
}
