import { useCallback, useEffect, useId, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { useConfirm } from "../components/ConfirmDialog";
import { GoldenPathStepper } from "../components/GoldenPathStepper";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/PageHeader";
import { StatusLine } from "../components/StatusLine";
import { ApiError, apiFetch, friendlyErrorMessage } from "../lib/api";
import type { Paginated } from "../lib/api";
import { useAuth } from "../lib/auth";
import { copyText, useAutoClearTimeout } from "../lib/browser";
import { filterByText } from "../lib/filterByText";
import { kbReady } from "../lib/journey";
import type { KnowledgeBase as FullKnowledgeBase, TeamOption } from "../lib/types";
import {
  badgeClass,
  cardClass,
  confidenceBadgeColor,
  destructiveButtonClass,
  inputClass,
  mutedTextClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../lib/ui";
import { EmptyState } from "../components/EmptyState";

// document_count/vector_count come along so the picker below can flag empty
// KBs (#1227) — building a pipeline over one is the classic "silent nothing".
export type KnowledgeBase = Pick<
  FullKnowledgeBase,
  "id" | "name" | "document_count" | "vector_count"
>;

export interface RagPipeline {
  id: string;
  name: string;
  knowledge_base_ids: string[];
  created_at: string;
  // Tenancy/sharing (#1046, Phase 4 slice 4): mirrors KnowledgeBase's
  // owner_id/visibility/team_id -- see lib/types.ts's KnowledgeBase for the
  // same fields' rationale. team_id is only set when visibility === "team".
  owner_id?: string | null;
  visibility?: "private" | "team" | "shared" | null;
  team_id?: number | null;
}

export interface DecisionStats {
  available: boolean;
  total_decisions: number;
  strategy_distribution: Record<string, number>;
  complexity_distribution: Record<string, number>;
  avg_confidence: number | null;
}

export interface Capabilities {
  methods: {
    standard: boolean;
    conversational: boolean;
    hyde: boolean;
    self_rag: boolean;
    auto: boolean;
    corrective: boolean;
    raptor: boolean;
  };
  enhancers: {
    rerank: { available: boolean; backend?: string };
    compress: { available: boolean };
  };
  retrievers: {
    dense: { available: boolean };
    hybrid: { available: boolean };
    parent_child: { available: boolean; note?: string };
    metadata_filter: { available: boolean; note?: string };
  };
}

type Method = "standard" | "hyde" | "self_rag" | "auto" | "corrective" | "raptor";

const METHOD_DESCRIPTIONS: Record<Method, string> = {
  standard: "Embeds your question and retrieves the closest matching chunks — fast, and the right default for most questions.",
  hyde: "Generates a hypothetical answer first, then searches using THAT instead of your raw question — often finds better matches for short or vaguely-worded questions.",
  self_rag: "Retrieves, then critiques its own retrieval and answer, re-retrieving if the first pass looks weak — slower, but catches cases where the first search missed the point.",
  auto: "Asks a small decision step to pick standard vs. a more expensive method per-question, so you don't have to guess in advance.",
  corrective: "Grades retrieved chunks for relevance before generating, discarding anything off-topic — reduces answers that ramble off irrelevant context.",
  raptor: "Searches across document summaries as well as raw chunks — better for broad \"summarize this\" questions no single chunk answers well. Only searches summaries for documents uploaded with \"Build search tree\" checked; otherwise behaves exactly like standard.",
};

// Same "single source of truth" pattern as METHOD_DESCRIPTIONS above -- these
// used to be inline JSX text duplicated only next to each checkbox, so they
// were invisible unless you already had a pipeline open and expanded
// "Advanced retrieval options". Reused below by the always-visible reference
// section, and by the checkboxes themselves (#485).
const ENHANCER_LABELS: Record<string, string> = {
  rerank: "Rerank",
  compress: "Compress",
  hybrid: "Hybrid retrieval",
  parent_context: "Parent context retrieval",
  continue_conversation: "Continue conversation",
};

const ENHANCER_DESCRIPTIONS: Record<string, string> = {
  rerank: "Re-scores retrieved chunks with a dedicated model for higher precision, before generation — costs a bit of latency.",
  compress: "Trims retrieved chunks down to the sentences actually relevant to your question before they reach the model.",
  hybrid: "Combines vector similarity with keyword search — catches exact terms, codes, or names that pure embeddings sometimes miss.",
  parent_context: "Returns the full surrounding section around a match, not just the matched chunk — more context per hit, at the cost of some precision.",
  continue_conversation: 'Keeps follow-up questions in the same session, so the model can resolve references like "it" or "that" back to earlier turns.',
};

/** Reference for the retrieval methods and add-ons. Kept so a user can learn
 * what they do WITHOUT first creating a KB and pipeline to reach the query form
 * that used to be the only place any of this was explained (#485) — but now a
 * default-collapsed disclosure BELOW the create form, so landing on Pipelines
 * to learn "what is a pipeline?" no longer hits a six-method wall first (#1228).
 * Progressive disclosure, same as Ask's "Advanced retrieval options". */
export function RetrievalMethodsReference() {
  return (
    <details className={`mb-4 ${cardClass}`}>
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
        <Icon name="search" size={16} className="text-indigo-500 dark:text-indigo-400" />
        Retrieval methods & add-ons — reference
        <span className="font-normal text-gray-500 dark:text-gray-400">
          (optional — pick these per question when you ask)
        </span>
      </summary>
      <div className="mt-3">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(Object.keys(METHOD_DESCRIPTIONS) as Method[]).map((m) => (
          <div key={m}>
            <dt className="font-mono text-sm font-medium text-gray-800 dark:text-gray-200">
              {m}
            </dt>
            <dd className="text-xs text-gray-600 dark:text-gray-400">
              {METHOD_DESCRIPTIONS[m]}
            </dd>
          </div>
        ))}
      </dl>
      <h3 className="mb-2 mt-4 text-sm font-semibold text-gray-900 dark:text-gray-100">
        Add-ons — combine with any method above, per question
      </h3>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Object.entries(ENHANCER_LABELS).map(([key, label]) => (
          <div key={key}>
            <dt className="text-sm font-medium text-gray-800 dark:text-gray-200">{label}</dt>
            <dd className="text-xs text-gray-600 dark:text-gray-400">
              {ENHANCER_DESCRIPTIONS[key]}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        Nothing here needs deciding up front — pick a method and toggle
        add-ons per question when you ask one below, in "Advanced retrieval
        options".
      </p>
      </div>
    </details>
  );
}

export interface Source {
  text: string;
  source: string;
  score: number;
}

export interface QueryResponse {
  answer: string;
  sources: Source[];
  confidence: number;
  model_used: string;
  tokens_used?: number | null;
  method: string;
  method_details?: {
    retrieval: string;
    degraded?: string[];
    metadata_filter?: { source?: string; document_id?: string };
  } | null;
}

export interface Turn {
  question: string;
  response: QueryResponse;
}

/** Shared by the single-shot result panel and each turn in a conversation
 * thread -- `compact` drops the source list for non-latest turns so an
 * ongoing conversation doesn't grow a wall of repeated citations. */
export function QueryResultCard({
  response,
  compact = false,
}: {
  response: QueryResponse;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const scheduleTimeout = useAutoClearTimeout();

  async function handleCopyAnswer() {
    if (!(await copyText(response.answer))) return;
    setCopied(true);
    scheduleTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <div className="mb-2 flex items-start gap-2">
        <p className="whitespace-pre-wrap">{response.answer}</p>
        <button
          onClick={handleCopyAnswer}
          title={copied ? "Answer copied" : "Copy answer"}
          aria-label={copied ? "Answer copied" : "Copy answer"}
          className="shrink-0 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
        >
          <Icon name={copied ? "check" : "copy"} size={14} />
        </button>
      </div>
      <p className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span className={`${badgeClass} ${confidenceBadgeColor(response.confidence)}`}>
          {Math.round(response.confidence * 100)}% confidence
        </span>
        <span>
          Model: {response.model_used}
          {response.tokens_used != null && ` (${response.tokens_used} tokens)`}
        </span>
        <span>
          Method: {response.method}
          {response.method_details?.retrieval && ` (${response.method_details.retrieval} retrieval)`}
        </span>
      </p>
      {response.method_details?.degraded && response.method_details.degraded.length > 0 && (
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
          ⚠ Degraded: {response.method_details.degraded.join(", ")}
        </p>
      )}
      {response.method_details?.metadata_filter && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Filtered to: {response.method_details.metadata_filter.source}
        </p>
      )}
      {!compact && response.sources.length > 0 && (
        <div className="mt-3 border-t border-gray-200 pt-2 dark:border-gray-700">
          <p className="mb-1 text-xs font-semibold text-gray-600 dark:text-gray-400">
            Sources
          </p>
          <ul className="flex flex-col gap-1">
            {response.sources.map((s, i) => (
              <li key={i} className="text-xs text-gray-600 dark:text-gray-400">
                [{s.source}] score {s.score.toFixed(3)} — {s.text.slice(0, 200)}
                {s.text.length > 200 && "…"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

export function CreatePipelineForm({
  token,
  kbs,
  onCreated,
}: {
  token: string;
  kbs: KnowledgeBase[];
  onCreated: (p: RagPipeline) => void;
}) {
  const nameId = useId();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const scheduleTimeout = useAutoClearTimeout();

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Warn (don't block — they may be about to upload) when the whole selection
  // is empty KBs, the case that silently yields empty answers (#1227).
  const noReadySelected =
    selected.size > 0 && !kbs.some((kb) => selected.has(kb.id) && kbReady(kb));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return; // already in flight -- ignore a double-click/tap
    if (!name.trim()) {
      setStatus("Name is required.");
      return;
    }
    if (selected.size === 0) {
      setStatus("Pick at least one knowledge base.");
      return;
    }
    setCreating(true);
    setStatus("Creating…");
    try {
      const res = await apiFetch<{
        pipeline_id: string;
        name: string;
        knowledge_base_ids: string[];
        created_at: string;
      }>("/v1/rag/pipeline", {
        method: "POST",
        body: { name, knowledge_base_ids: Array.from(selected) },
        token,
      });
      onCreated({
        id: res.pipeline_id,
        name: res.name,
        knowledge_base_ids: res.knowledge_base_ids,
        created_at: res.created_at,
      });
      setName("");
      setSelected(new Set());
      setStatus("Created.");
      scheduleTimeout(() => setStatus(""), 2000);
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className={`mb-6 ${cardClass}`}>
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
        <Icon name="plus" size={16} className="text-indigo-500 dark:text-indigo-400" />
        Create a pipeline
      </h2>
      {kbs.length === 0 ? (
        <EmptyState>
          Create a knowledge base first — a pipeline needs at least one to
          search over.
        </EmptyState>
      ) : (
        <form onSubmit={handleSubmit}>
          <fieldset disabled={!token || creating} className="mt-2 flex flex-col gap-3">
            <div>
              <label
                htmlFor={nameId}
                className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Name
              </label>
              <input
                id={nameId}
                className={inputClass}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <fieldset>
              <legend className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Knowledge bases
              </legend>
              <div className="flex flex-col gap-1">
                {kbs.map((kb) => (
                  <label key={kb.id} className="flex items-center gap-2 text-sm">
                    <input
                      className="h-4 w-4 rounded border-gray-300 disabled:cursor-not-allowed disabled:opacity-60"
                      type="checkbox"
                      checked={selected.has(kb.id)}
                      onChange={() => toggle(kb.id)}
                    />
                    {kb.name}
                    {!kbReady(kb) && (
                      <span className="text-xs text-amber-600 dark:text-amber-400">
                        (no documents yet)
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </fieldset>
            {noReadySelected && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                None of the selected knowledge bases have documents yet — a
                pipeline over them will return empty answers until you upload
                some.
              </p>
            )}
            <div className="flex items-center gap-3">
              <button type="submit" disabled={!token} className={primaryButtonClass}>
                Create
              </button>
              {!token && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Log in to create a pipeline.
                </span>
              )}
              <span className="text-sm text-gray-500 dark:text-gray-400">{status}</span>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}

/** First 8 chars of a UUID + ellipsis — enough to eyeball/distinguish without
 * the full 36-char string dominating a card meant for a first-time user. */
function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

export function PipelineCard({
  pipeline,
  token,
  myTeams = [],
  kbNames = {},
  onDeleted,
  onUpdated,
  confirm,
}: {
  pipeline: RagPipeline;
  token: string;
  myTeams?: TeamOption[];
  /** id → display name for this pipeline's knowledge bases, so the card can
   * show "Support docs" instead of a raw UUID (#1231). Missing ids fall back
   * to a shortened id. */
  kbNames?: Record<string, string>;
  onDeleted: (id: string) => void;
  onUpdated: (pipeline: RagPipeline) => void;
  confirm: ReturnType<typeof useConfirm>["confirm"];
}) {
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [copied, setCopied] = useState(false);
  const scheduleTimeout = useAutoClearTimeout();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(pipeline.name);
  const [editVisibility, setEditVisibility] = useState<"private" | "team" | "shared">(
    pipeline.visibility ?? "private",
  );
  const [editTeamId, setEditTeamId] = useState<number | "">(pipeline.team_id ?? "");
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setEditName(pipeline.name);
    setEditVisibility(pipeline.visibility ?? "private");
    setEditTeamId(pipeline.team_id ?? "");
    setStatus("");
    setIsError(false);
    setEditing(true);
  }

  async function handleRename() {
    if (!editName.trim()) {
      setStatus("Name can't be empty.");
      setIsError(true);
      return;
    }
    if (editVisibility === "team" && editTeamId === "") {
      setStatus("Choose a team to share this pipeline with.");
      setIsError(true);
      return;
    }
    setSaving(true);
    setStatus("Saving…");
    setIsError(false);
    try {
      const updated = await apiFetch<RagPipeline>(
        `/v1/rag/pipeline/${pipeline.id}`,
        {
          method: "PATCH",
          body: {
            name: editName.trim(),
            visibility: editVisibility,
            team_id: editVisibility === "team" ? editTeamId : null,
          },
          token,
        },
      );
      onUpdated(updated);
      setStatus("");
      setEditing(false);
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    }
    setSaving(false);
  }

  async function handleDelete() {
    const ok = await confirm({
      title: "Delete pipeline?",
      message: `This permanently deletes "${pipeline.name}". The knowledge bases it searches over are not affected.`,
      danger: true,
    });
    if (!ok) return;
    setStatus("Deleting…");
    setIsError(false);
    try {
      await apiFetch(`/v1/rag/pipeline/${pipeline.id}`, { method: "DELETE", token });
      onDeleted(pipeline.id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setStatus("This pipeline no longer exists on the server — removed from your list.");
        onDeleted(pipeline.id);
        return;
      }
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    }
  }

  async function handleCopy() {
    if (!(await copyText(pipeline.id))) return;
    setCopied(true);
    scheduleTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className={`mb-4 ${cardClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <input
                  className={inputClass}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  aria-label="Pipeline name"
                  disabled={saving}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label
                  className="text-xs text-gray-500 dark:text-gray-400"
                  htmlFor={`visibility-${pipeline.id}`}
                >
                  Visibility
                </label>
                <select
                  id={`visibility-${pipeline.id}`}
                  className={inputClass}
                  value={editVisibility}
                  onChange={(e) =>
                    setEditVisibility(e.target.value as "private" | "team" | "shared")
                  }
                  disabled={saving}
                >
                  <option value="private">🔒 Private (only me)</option>
                  <option value="team">👥 Team</option>
                  <option value="shared">🌐 Shared (everyone)</option>
                </select>
                {editVisibility === "team" && (
                  <select
                    className={inputClass}
                    value={editTeamId}
                    onChange={(e) => setEditTeamId(Number(e.target.value))}
                    disabled={saving}
                    aria-label="Team to share with"
                  >
                    <option value="" disabled>
                      Choose a team…
                    </option>
                    {myTeams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  className={primaryButtonClass}
                  onClick={handleRename}
                  disabled={saving}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  className={secondaryButtonClass}
                  onClick={() => setEditing(false)}
                  disabled={saving}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
              <Icon name="pipelines" size={17} className="text-indigo-500 dark:text-indigo-400" />
              {pipeline.name}
            </h2>
          )}
          <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
            Knowledge bases:{" "}
            {pipeline.knowledge_base_ids.length === 0
              ? "none"
              : pipeline.knowledge_base_ids.map((id, i) => (
                  <span key={id} title={id}>
                    {i > 0 && ", "}
                    <span className="font-medium text-gray-700 dark:text-gray-300">
                      {kbNames[id] ?? shortId(id)}
                    </span>
                  </span>
                ))}
          </p>
          <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">
            <span title={pipeline.id}>
              id: <code>{shortId(pipeline.id)}</code>
            </span>
            <button
              type="button"
              onClick={handleCopy}
              title="Copy full pipeline id"
              className="ml-1.5 underline hover:text-gray-600 dark:hover:text-gray-300"
            >
              {copied ? "copied" : "copy"}
            </button>
          </p>
          {!editing && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {pipeline.visibility === "team"
                ? `👥 Shared with team${
                    myTeams.find((t) => t.id === pipeline.team_id)
                      ? `: ${myTeams.find((t) => t.id === pipeline.team_id)!.name}`
                      : ""
                  }`
                : pipeline.visibility === "shared"
                  ? "🌐 Shared (everyone)"
                  : "🔒 Private (only me)"}
            </p>
          )}
        </div>
        {!editing && (
          <div className="flex shrink-0 gap-2">
            <button
              className={secondaryButtonClass}
              onClick={startEdit}
              disabled={!token}
            >
              <Icon name="edit" size={15} />
              Edit
            </button>
            <button
              className={destructiveButtonClass}
              onClick={handleDelete}
              disabled={!token}
            >
              <Icon name="delete" size={15} />
              Delete
            </button>
          </div>
        )}
      </div>
      {!token && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Log in to edit or delete this pipeline.
        </p>
      )}
      <StatusLine isError={isError}>{status}</StatusLine>
      {/* Ask is the single canonical query surface now (#1229) — the card used
          to embed a full duplicate of it. Deep-link to Ask with this pipeline
          preselected instead of asking here. */}
      <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-800">
        <Link
          to={`/ask?pipeline=${encodeURIComponent(pipeline.id)}`}
          className={primaryButtonClass}
        >
          <Icon name="ask" size={16} />
          Ask this pipeline
        </Link>
      </div>
    </section>
  );
}

/** Auto-router (method="auto") analytics, from GET /v1/rag/decision-stats. The
 * decision engine records the strategy/complexity/confidence of every auto query;
 * this surfaces the cumulative distribution so you can see how it's behaving.
 * Rendered only when the engine is available (Ollama up) — hidden otherwise so it
 * doesn't add noise on deployments that don't use the auto method. */
export function AutoRouterStatsCard({ stats }: { stats: DecisionStats | null }) {
  if (!stats || !stats.available) return null;

  const dist = (counts: Record<string, number>) =>
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => (
        <span key={k} className={badgeClass}>
          {k}: {n}
        </span>
      ));

  return (
    <div className={`${cardClass} mb-4`}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
          <Icon name="status" size={15} className="text-indigo-500 dark:text-indigo-400" />
          Auto-router analytics
        </h3>
        <span className={mutedTextClass}>
          {stats.total_decisions} decision
          {stats.total_decisions === 1 ? "" : "s"} recorded
        </span>
      </div>
      {stats.total_decisions === 0 ? (
        <p className={mutedTextClass}>
          No <code>method=auto</code> queries recorded yet — run one to see which
          retrieval strategy the router picks. Counts are in-memory and reset on
          restart.
        </p>
      ) : (
        <div className="flex flex-col gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-gray-600 dark:text-gray-400">
              Strategy:
            </span>
            {dist(stats.strategy_distribution)}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-gray-600 dark:text-gray-400">
              Complexity:
            </span>
            {dist(stats.complexity_distribution)}
          </div>
          {stats.avg_confidence !== null && (
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-gray-600 dark:text-gray-400">
                Avg confidence:
              </span>
              <span
                className={`inline-block rounded-full px-2 py-0.5 font-medium ${confidenceBadgeColor(
                  stats.avg_confidence,
                )}`}
              >
                {(stats.avg_confidence * 100).toFixed(0)}%
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function RagPipelinesPage() {
  const { token } = useAuth();
  const { confirm, dialog } = useConfirm();
  const [searchParams] = useSearchParams();
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [decisionStats, setDecisionStats] = useState<DecisionStats | null>(null);
  const [pipelines, setPipelines] = useState<RagPipeline[]>([]);
  const [myTeams, setMyTeams] = useState<TeamOption[]>([]);
  // Seed from ?q= so the ⌘K palette can deep-link to a specific pipeline (#1210).
  const [filter, setFilter] = useState(() => searchParams.get("q") ?? "");
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);

  const visiblePipelines = filterByText(pipelines, filter, (p) => [
    p.name,
    ...p.knowledge_base_ids,
  ]);

  // id -> name for the pipeline cards, so they show KB names not raw UUIDs
  // (#1231). The list is already fetched for the create-form picker.
  const kbNames = Object.fromEntries(kbs.map((k) => [k.id, k.name]));

  const setStatusMsg = useCallback((msg: string, err = false) => {
    setStatus(msg);
    setIsError(err);
  }, []);

  const load = useCallback(async () => {
    setStatusMsg("Loading…");
    try {
      const [kbList, pipelineList, stats] = await Promise.all([
        apiFetch<Paginated<KnowledgeBase>>("/v1/rag/knowledge-bases?limit=100", {
          token,
        }),
        // JWT-gated (owner-scoped under tenancy): 401s without the token, which
        // failed the whole page load with a misleading "session expired".
        apiFetch<Paginated<RagPipeline>>("/v1/rag/pipeline?limit=100", { token }),
        // Newer endpoint (auto-router analytics) — degrade gracefully rather than
        // failing the whole page load against a backend that predates it.
        apiFetch<DecisionStats>("/v1/rag/decision-stats").catch(() => null),
      ]);
      setKbs(kbList.items);
      setPipelines(pipelineList.items);
      setDecisionStats(stats);
      setStatusMsg("");
    } catch (e) {
      setStatusMsg(friendlyErrorMessage(e), true);
    }
  }, [setStatusMsg, token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!token) {
      setMyTeams([]);
      return;
    }
    // GET /v1/teams lists EVERY team on the instance, not just the caller's --
    // there's no "my teams" filter endpoint yet, so the picker shows all of
    // them; sharing with one the caller isn't a member of just fails
    // server-side with a clear message. Same pattern as KnowledgeBasesPage.
    apiFetch<{ teams: TeamOption[] }>("/v1/teams?limit=500", { token })
      .then((res) => setMyTeams(res.teams))
      .catch(() => setMyTeams([]));
  }, [token]);

  function handlePipelineDeleted(id: string) {
    setPipelines((prev) => prev.filter((p) => p.id !== id));
  }

  function handlePipelineUpdated(updated: RagPipeline) {
    setPipelines((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }

  return (
    <>
      {dialog}
      <PageHeader
        icon="pipelines"
        title="Pipelines"
        subtitle={
          <>
            A <strong>pipeline</strong> is the thing you ask questions against:
            it points at one or more <em>knowledge bases</em> (your uploaded
            documents) and answers using Minder's own retrieval — RAG
            (retrieval-augmented generation). Create one below, then ask it in{" "}
            <em>Ask</em>. This is separate from OpenWebUI's own disconnected
            Knowledge feature.
          </>
        }
        actions={
          <Link to="/ask" className={secondaryButtonClass}>
            <Icon name="ask" size={16} />
            Open Ask
          </Link>
        }
      />
      <GoldenPathStepper refreshKey={pipelines.length} />
      <StatusLine isError={isError}>{status}</StatusLine>
      <CreatePipelineForm
        token={token}
        kbs={kbs}
        onCreated={(p) => setPipelines((prev) => [...prev, p])}
      />
      {/* Reference + analytics demoted below the create form (#1228) so the
          page leads with "what is a pipeline?" and the create action, not a
          wall of retrieval-method copy. */}
      <RetrievalMethodsReference />
      <AutoRouterStatsCard stats={decisionStats} />
      {pipelines.length === 0 && (
        <EmptyState>
          No pipelines created yet — pick at least one knowledge base above.
        </EmptyState>
      )}
      {pipelines.length > 1 && (
        <div className="mb-3 flex items-center gap-3">
          <input
            className={`${inputClass} max-w-xs`}
            type="text"
            placeholder="Filter by name or knowledge base id…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter pipelines"
          />
          {filter.trim() && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {visiblePipelines.length} of {pipelines.length}
            </span>
          )}
        </div>
      )}
      {pipelines.length > 0 && visiblePipelines.length === 0 && (
        <EmptyState>No pipelines match "{filter}".</EmptyState>
      )}
      {visiblePipelines.map((p) => (
        <PipelineCard
          key={p.id}
          pipeline={p}
          token={token}
          myTeams={myTeams}
          kbNames={kbNames}
          onDeleted={handlePipelineDeleted}
          onUpdated={handlePipelineUpdated}
          confirm={confirm}
        />
      ))}
    </>
  );
}
