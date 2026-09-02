import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { EmptyState } from "../components/EmptyState";
import { GoldenPathStepper } from "../components/GoldenPathStepper";
import { Icon } from "../components/Icon";
import { InfoCallout } from "../components/InfoCallout";
import { PageHeader } from "../components/PageHeader";
import { ApiError, apiFetch, friendlyErrorMessage } from "../lib/api";
import type { Paginated } from "../lib/api";
import { useAuth } from "../lib/auth";
import { randomId } from "../lib/browser";
import { type ScopeDocument, fetchScopeDocuments } from "../lib/ragDocuments";
import { usableRewriteModels } from "../lib/rewriteModel";
import {
  cardClass,
  fieldHintClass,
  inputClass,
  mutedTextClass,
  primaryButtonClass,
  secondaryButtonClass,
  surfaceMutedClass,
} from "../lib/ui";
import { type ModelInfo } from "./ModelManagementPage";
import {
  type Capabilities,
  type QueryResponse,
  QueryResultCard,
  type RagPipeline,
} from "./RagPipelinesPage";

type Method = "standard" | "hyde" | "self_rag" | "auto" | "corrective" | "raptor";

const METHODS: { value: Method; hint: string }[] = [
  { value: "standard", hint: "Fast, best default for most questions." },
  { value: "hyde", hint: "Drafts a hypothetical answer first — better for vague questions." },
  { value: "self_rag", hint: "Critiques and re-retrieves if the first pass looks weak." },
  { value: "auto", hint: "Picks the method per question for you." },
  { value: "corrective", hint: "Grades chunks for relevance before answering." },
  { value: "raptor", hint: "Also searches document summaries — good for broad questions." },
];

const SUGGESTIONS = [
  "Summarize the key points across these documents.",
  "What does the refund policy say about digital purchases?",
  "List the main risks mentioned and where each appears.",
  "Who is responsible for onboarding, according to the handbook?",
];

interface UserTurn {
  id: string;
  role: "user";
  text: string;
}
interface AssistantTurn {
  id: string;
  role: "assistant";
  pending?: boolean;
  response?: QueryResponse;
  error?: string;
}
type Turn = UserTurn | AssistantTurn;

/** The flagship "just ask" surface. Minder's core value — answering questions
 * over your own documents — used to be buried three clicks deep inside a
 * pipeline card behind an "Advanced retrieval options" disclosure. This puts
 * it front and centre: pick a pipeline, type, get an answer with its sources,
 * and keep the thread going. Power controls (method, retrieval add-ons) stay
 * one disclosure away so the default path is a single text box. The heavy
 * lifting (answer rendering, source list, confidence) reuses the same
 * QueryResultCard the Pipelines page uses, so answers look identical wherever
 * you ask from. */
export function AskPage() {
  const { token, isAuthenticated } = useAuth();
  // Deep-link entry points (#1229): "Ask this pipeline" from a pipeline card
  // (?pipeline=<id>) and "Continue →" from Conversations (?conversation_id=<id>).
  // Seeded once as initial state; load() keeps a preselected pipeline if it
  // exists, and a seeded conversation_id continues that thread server-side
  // (conversations key on the id alone, so any pipeline continues it).
  const [searchParams] = useSearchParams();
  const [pipelines, setPipelines] = useState<RagPipeline[]>([]);
  const [pipelineId, setPipelineId] = useState<string>(
    () => searchParams.get("pipeline") ?? "",
  );
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(
    () => searchParams.get("conversation_id"),
  );
  const continuingFromHistory = Boolean(searchParams.get("conversation_id"));

  const [method, setMethod] = useState<Method>("standard");
  const [topK, setTopK] = useState("5");
  const [rerank, setRerank] = useState(false);
  const [compress, setCompress] = useState(false);
  const [hybrid, setHybrid] = useState(false);
  const [parentContext, setParentContext] = useState(false);
  const [sourceFilter, setSourceFilter] = useState("");
  const [llmModels, setLlmModels] = useState<string[]>([]);
  const [llmModel, setLlmModel] = useState("");
  const [docs, setDocs] = useState<ScopeDocument[]>([]);
  const [documentId, setDocumentId] = useState("");

  const questionId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const methodAvailable = (m: Method) => capabilities?.methods[m] !== false;
  const rerankAvailable = capabilities?.enhancers.rerank.available ?? false;
  const compressAvailable = capabilities?.enhancers.compress.available ?? false;
  const hybridAvailable = capabilities?.retrievers.hybrid.available ?? false;
  const conversationalAvailable = capabilities?.methods.conversational ?? false;
  const advancedCount = [
    rerank,
    compress,
    hybrid,
    parentContext,
    sourceFilter.trim().length > 0,
    llmModel.length > 0,
    documentId.length > 0,
  ].filter(Boolean).length;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [caps, pipelineList] = await Promise.all([
        apiFetch<Capabilities>("/v1/rag/capabilities"),
        // GET /v1/rag/pipeline is JWT-gated (owner-scoped under tenancy) — it
        // 401s without the token, so pass it or the whole load fails with a
        // misleading "session expired" even while logged in.
        apiFetch<Paginated<RagPipeline>>("/v1/rag/pipeline?limit=100", { token }),
      ]);
      setCapabilities(caps);
      setPipelines(pipelineList.items);
      setPipelineId((prev) =>
        prev && pipelineList.items.some((p) => p.id === prev)
          ? prev
          : (pipelineList.items[0]?.id ?? ""),
      );
    } catch (e) {
      setLoadError(friendlyErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // Best-effort: offer the pulled generation models as a per-question override
  // of the pipeline's KB-configured llm_model. Kept out of `load`'s Promise.all
  // so a host without model-management (or an empty model list) still asks fine
  // — the picker just falls back to its single "(pipeline default)" option.
  useEffect(() => {
    apiFetch<Paginated<ModelInfo>>("/v1/models?limit=500")
      .then((res) => setLlmModels(usableRewriteModels(res.items).map((m) => m.id)))
      .catch(() => {});
  }, []);

  // Documents in the selected pipeline's KBs, for the "scope to one document"
  // filter (more precise than the filename filter, which collides across
  // re-uploads). Best-effort; re-fetched whenever the pipeline changes.
  useEffect(() => {
    const pipeline = pipelines.find((p) => p.id === pipelineId);
    if (!token || !pipeline) {
      setDocs([]);
      return;
    }
    const controller = new AbortController();
    fetchScopeDocuments(pipeline.knowledge_base_ids, token, controller.signal)
      .then(setDocs)
      .catch(() => {});
    return () => controller.abort();
  }, [pipelineId, pipelines, token]);

  // Auto-scroll the transcript to the latest turn as it grows.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  function newChat() {
    setTurns([]);
    setConversationId(null);
    setInput("");
    textareaRef.current?.focus();
  }

  function switchPipeline(id: string) {
    setPipelineId(id);
    // A fresh pipeline means a fresh thread — the old conversation_id carried
    // context that no longer applies to a different set of knowledge bases.
    setTurns([]);
    setConversationId(null);
    // The old document scope belonged to the previous pipeline's KBs.
    setDocumentId("");
  }

  const selectedPipeline = pipelines.find((p) => p.id === pipelineId);

  async function ask(text: string) {
    const question = text.trim();
    if (!question || sending || !pipelineId || !token) return;

    let convId = conversationId;
    if (conversationalAvailable && !convId) {
      convId = randomId();
      setConversationId(convId);
    }

    const userTurn: UserTurn = { id: randomId(), role: "user", text: question };
    const pendingId = randomId();
    setTurns((prev) => [
      ...prev,
      userTurn,
      { id: pendingId, role: "assistant", pending: true },
    ]);
    setInput("");
    setSending(true);

    const parsedTopK = parseInt(topK, 10);
    const body: Record<string, unknown> = {
      question,
      top_k: Number.isNaN(parsedTopK) || parsedTopK < 1 ? 5 : parsedTopK,
      method,
      rerank,
      compress,
      hybrid: parentContext ? false : hybrid,
      parent_context: parentContext,
    };
    if (conversationalAvailable && convId) body.conversation_id = convId;
    const metadataFilter: Record<string, string> = {};
    if (documentId) metadataFilter.document_id = documentId;
    if (sourceFilter.trim()) metadataFilter.source = sourceFilter.trim();
    if (Object.keys(metadataFilter).length) body.metadata_filter = metadataFilter;
    if (llmModel) body.llm_model = llmModel;

    try {
      const res = await apiFetch<QueryResponse>(
        `/v1/rag/pipeline/${pipelineId}/query`,
        { method: "POST", body, token },
      );
      setTurns((prev) =>
        prev.map((t) =>
          t.id === pendingId ? { id: pendingId, role: "assistant", response: res } : t,
        ),
      );
    } catch (e) {
      const msg =
        e instanceof ApiError && e.status === 404
          ? "This pipeline no longer exists on the server. Reloading your pipelines…"
          : friendlyErrorMessage(e);
      setTurns((prev) =>
        prev.map((t) =>
          t.id === pendingId ? { id: pendingId, role: "assistant", error: msg } : t,
        ),
      );
      if (e instanceof ApiError && e.status === 404) load();
    } finally {
      setSending(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    ask(input);
  }

  function onTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline — the chat-composer convention.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask(input);
    }
  }

  return (
    <>
      <PageHeader
        icon="ask"
        title="Ask"
        subtitle="Chat with your knowledge bases using Minder's own retrieval — pick a pipeline and ask."
        actions={
          turns.length > 0 ? (
            <button type="button" onClick={newChat} className={secondaryButtonClass}>
              <Icon name="plus" size={16} />
              New chat
            </button>
          ) : undefined
        }
      />

      <GoldenPathStepper />

      {continuingFromHistory && turns.length === 0 && (
        <InfoCallout icon="conversations">
          Continuing a conversation from your history — ask your next question
          below and it picks up the same thread.
        </InfoCallout>
      )}

      {loadError && (
        <InfoCallout icon="warning" tone="warn">
          {loadError}{" "}
          <button onClick={load} className="font-medium underline">
            Retry
          </button>
        </InfoCallout>
      )}

      {!loading && pipelines.length === 0 && !loadError && (
        <EmptyState className="mt-2">
          You have no pipelines yet. Create a knowledge base and a{" "}
          <Link to="/rag/pipelines" className="font-medium text-indigo-600 underline dark:text-indigo-400">
            pipeline
          </Link>{" "}
          to start asking questions.
        </EmptyState>
      )}

      {pipelines.length > 0 && (
        <>
          {/* Pipeline picker + at-a-glance context. */}
          <div className={`mb-4 flex flex-wrap items-center gap-3 ${cardClass}`}>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              <Icon name="pipelines" size={16} className="text-gray-400" />
              Pipeline
            </label>
            <select
              className={`${inputClass} w-auto min-w-52 flex-1`}
              value={pipelineId}
              onChange={(e) => switchPipeline(e.target.value)}
              aria-label="Pipeline to query"
            >
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {selectedPipeline && (
              <span className={mutedTextClass}>
                {selectedPipeline.knowledge_base_ids.length} knowledge base
                {selectedPipeline.knowledge_base_ids.length === 1 ? "" : "s"}
              </span>
            )}
            <Link
              to="/rag/pipelines"
              className="ml-auto flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
            >
              Manage
              <Icon name="arrow" size={14} />
            </Link>
          </div>

          {/* Transcript. */}
          <div
            ref={scrollRef}
            role="log"
            aria-live="polite"
            aria-label="Conversation"
            className={`${cardClass} mb-4 max-h-[calc(100vh-24rem)] min-h-64 overflow-y-auto`}
          >
            {turns.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 py-10 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-500 ring-1 ring-inset ring-indigo-100 dark:bg-indigo-950/50 dark:text-indigo-300 dark:ring-indigo-900">
                  <Icon name="ask" size={26} />
                </span>
                <div>
                  <p className="font-medium text-gray-900 dark:text-gray-100">
                    Ask anything about your documents
                  </p>
                  <p className={`mt-1 ${mutedTextClass}`}>
                    Answers are grounded in{" "}
                    {selectedPipeline?.name ?? "your pipeline"} and cite their sources.
                  </p>
                </div>
                <div className="flex max-w-lg flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={!token}
                      onClick={() => ask(s)}
                      className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 transition hover:border-indigo-300 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:border-indigo-700 dark:hover:text-indigo-300"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {turns.map((turn) =>
                  turn.role === "user" ? (
                    <div key={turn.id} className="flex justify-end">
                      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-2.5 text-sm text-white shadow-sm">
                        {turn.text}
                      </div>
                    </div>
                  ) : (
                    <div key={turn.id} className="flex gap-2.5">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100 dark:bg-indigo-950/50 dark:text-indigo-300 dark:ring-indigo-900">
                        <Icon name="ask" size={16} />
                      </span>
                      <div
                        className={`min-w-0 flex-1 ${surfaceMutedClass} p-4 text-sm text-gray-900 dark:text-gray-100`}
                      >
                        {turn.pending ? (
                          <span className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                            <span className="flex gap-1">
                              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
                              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
                              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
                            </span>
                            Thinking…
                          </span>
                        ) : turn.error ? (
                          <span className="flex items-center gap-2 text-red-600 dark:text-red-400">
                            <Icon name="warning" size={16} />
                            {turn.error}
                          </span>
                        ) : turn.response ? (
                          <QueryResultCard response={turn.response} />
                        ) : null}
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>

          {/* Composer. */}
          {!token && (
            <InfoCallout icon="lock">
              <Link to="/login" className="font-medium underline">
                Log in
              </Link>{" "}
              to ask questions. Browsing your pipelines is open to everyone.
            </InfoCallout>
          )}

          <form onSubmit={onSubmit} className={`mt-4 ${cardClass}`}>
            <div className="flex items-end gap-2">
              <textarea
                id={questionId}
                ref={textareaRef}
                className={`${inputClass} max-h-40 min-h-11 resize-none`}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onTextareaKeyDown}
                rows={1}
                disabled={!token || sending}
                placeholder={
                  token ? "Ask a follow-up… (Enter to send, Shift+Enter for a new line)" : "Log in to ask a question"
                }
                aria-label="Your question"
              />
              <button
                type="submit"
                disabled={!token || sending || !input.trim()}
                className={`${primaryButtonClass} h-11 px-4`}
              >
                <Icon name={sending ? "reset" : "send"} size={16} className={sending ? "animate-spin" : undefined} />
                <span className="hidden sm:inline">{sending ? "Asking…" : "Ask"}</span>
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400">
                Method
                <select
                  className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                  value={method}
                  onChange={(e) => setMethod(e.target.value as Method)}
                >
                  {METHODS.map((m) => (
                    <option key={m.value} value={m.value} disabled={!methodAvailable(m.value)}>
                      {m.value}
                      {!methodAvailable(m.value) ? " (unavailable)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400">
                Top K
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={topK}
                  onChange={(e) => setTopK(e.target.value)}
                  className="w-16 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                />
              </label>
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100">
                  <Icon name="chevron-right" size={13} className="transition group-open:rotate-90" />
                  Advanced
                  {advancedCount > 0 && (
                    <span className="text-indigo-600 dark:text-indigo-400">({advancedCount})</span>
                  )}
                </summary>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                    <input type="checkbox" checked={rerank} disabled={!rerankAvailable} onChange={(e) => setRerank(e.target.checked)} className="h-3.5 w-3.5 rounded border-gray-300" />
                    Rerank{!rerankAvailable && " (unavailable)"}
                  </label>
                  <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                    <input type="checkbox" checked={compress} disabled={!compressAvailable} onChange={(e) => setCompress(e.target.checked)} className="h-3.5 w-3.5 rounded border-gray-300" />
                    Compress{!compressAvailable && " (unavailable)"}
                  </label>
                  <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                    <input type="checkbox" checked={hybrid} disabled={!hybridAvailable || parentContext} onChange={(e) => setHybrid(e.target.checked)} className="h-3.5 w-3.5 rounded border-gray-300" />
                    Hybrid retrieval{!hybridAvailable && " (unavailable)"}
                  </label>
                  <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                    <input type="checkbox" checked={parentContext} onChange={(e) => setParentContext(e.target.checked)} className="h-3.5 w-3.5 rounded border-gray-300" />
                    Parent context
                  </label>
                  {llmModels.length > 0 && (
                    <label className="col-span-full flex flex-col gap-1 text-xs text-gray-700 dark:text-gray-300">
                      Generation model
                      <select
                        value={llmModel}
                        onChange={(e) => setLlmModel(e.target.value)}
                        className={inputClass}
                      >
                        <option value="">(pipeline default)</option>
                        {llmModels.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                      <span className={fieldHintClass}>
                        Answer this question with a specific model instead of the
                        pipeline's configured one — e.g. a stronger model for a
                        hard question. Retrieval is unchanged.
                      </span>
                    </label>
                  )}
                  {docs.length > 0 && (
                    <label className="col-span-full flex flex-col gap-1 text-xs text-gray-700 dark:text-gray-300">
                      Scope to a document
                      <select
                        value={documentId}
                        onChange={(e) => setDocumentId(e.target.value)}
                        className={inputClass}
                      >
                        <option value="">(all documents)</option>
                        {docs.map((d) => (
                          <option key={d.document_id} value={d.document_id}>
                            {d.filename}
                          </option>
                        ))}
                      </select>
                      <span className={fieldHintClass}>
                        Answer using only this one uploaded document — precise even
                        when two uploads share a filename.
                      </span>
                    </label>
                  )}
                  <label className="col-span-full flex flex-col gap-1 text-xs text-gray-700 dark:text-gray-300">
                    Filter by filename
                    <input
                      type="text"
                      value={sourceFilter}
                      onChange={(e) => setSourceFilter(e.target.value)}
                      placeholder="e.g. handbook.pdf — leave empty to search everything"
                      className={inputClass}
                    />
                    <span className={fieldHintClass}>
                      Restrict retrieval to a single uploaded file (exact filename match).
                    </span>
                  </label>
                </div>
              </details>
              {conversationalAvailable && conversationId && (
                <span className="ml-auto flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                  <Icon name="conversations" size={13} />
                  Conversation active
                </span>
              )}
            </div>
          </form>

          {isAuthenticated && !conversationalAvailable && turns.length > 0 && (
            <p className={`mt-2 ${fieldHintClass}`}>
              Conversational memory is unavailable on this host — each question is
              answered independently.
            </p>
          )}
        </>
      )}
    </>
  );
}
