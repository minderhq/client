import { useEffect, useId, useState } from "react";

import { useConfirm } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { InfoCallout } from "../components/InfoCallout";
import { PageHeader } from "../components/PageHeader";
import { StatusLine } from "../components/StatusLine";
import { apiFetch, friendlyErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { randomId } from "../lib/browser";
import type { TeamOption } from "../lib/types";
import {
  cardClass,
  destructiveButtonClass,
  fieldHintClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../lib/ui";
import { type AsyncResource, useAsyncResource } from "../lib/useAsyncResource";

interface Entity {
  text: string;
  label: string;
  [key: string]: unknown;
}

interface Relationship {
  source: string;
  target: string;
  type: string;
  [key: string]: unknown;
}

interface ExtractResponse {
  success: boolean;
  entities: Entity[];
  relationships: Relationship[];
  entity_count: number;
  relationship_count: number;
}

interface ConstructResponse {
  success: boolean;
  document_id: string;
  entity_count: number;
  relationship_count: number;
  message: string;
}

interface RelatedEntity {
  text: string;
  [key: string]: unknown;
}

interface RetrieveResponse {
  success: boolean;
  query: string;
  related_entities: RelatedEntity[];
  entity_count: number;
  retrieval_time_ms: number;
}

interface EntityContextResponse {
  success: boolean;
  entity: Record<string, unknown>;
  related_entities: RelatedEntity[];
  documents: { id?: string; title?: string }[];
  context_window: number;
}

interface GraphSearchResponse {
  success: boolean;
  query: string;
  entities: Entity[];
  entity_count: number;
}

interface CorrelateRunResult {
  success: boolean;
  results: { correlator: string; edges: number }[];
  skipped: string[];
}

interface CorrelationItem {
  text: string;
  label?: string;
  count?: number;
  score?: number;
  // 0-1 normalized degree centrality, present on every item only when the
  // lookup was made with include_centrality=true (#994 / #1214).
  centrality_score?: number;
  // Multi-hop path metadata — only on `indirect` items (max_hops > 1, #1214):
  // how many CO_OCCURS/SIMILAR_TO hops away, and the edge types traversed.
  hops?: number;
  via?: string[];
  [key: string]: unknown;
}

interface CorrelatedSignal {
  signal: string;
  correlated_with: string;
  coef: number;
  entities: string[];
  [key: string]: unknown;
}

interface CorrelationsResult {
  success: boolean;
  entity: string;
  found: boolean;
  co_occurring: CorrelationItem[];
  similar: CorrelationItem[];
  same_as: CorrelationItem[];
  correlated_signals: CorrelatedSignal[];
  // Bounded multi-hop relationships — only populated when max_hops > 1 (#1214).
  indirect?: CorrelationItem[];
  // Degree centrality of the queried entity itself — only when
  // include_centrality=true (#994 / #1214).
  entity_centrality_score?: number | null;
}

function EntityBadge({ entity }: { entity: Entity | RelatedEntity }) {
  const label = "label" in entity ? String(entity.label) : undefined;
  return (
    <span className="inline-block rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
      {entity.text}
      {label && <span className="ml-1 opacity-70">({label})</span>}
    </span>
  );
}

interface GraphStats {
  success: boolean;
  nodes: number;
  relationships: number;
  documents: number;
  entities: number;
  entity_types: Record<string, number>;
}

interface GraphDocument {
  id: string;
  title: string | null;
  source: string | null;
  created_at: string | null;
  entity_count: number;
  // #1046/#1063: always "private" at construct time -- changeable via
  // PATCH /v1/graph-rag/graph/document/{id}, see DocumentVisibilityCard.
  visibility: "private" | "team" | "shared" | null;
  team_id: number | null;
}

interface GraphDocumentsResponse {
  success: boolean;
  documents: GraphDocument[];
  count: number;
}

interface BuiltDoc {
  documentId: string;
  title: string;
  entityCount: number;
  relationshipCount: number;
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800">
      <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {value.toLocaleString()}
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
    </div>
  );
}

function GraphOverviewCard({ stats }: { stats: AsyncResource<GraphStats> }) {
  const data = stats.data;
  const isEmpty = data != null && data.nodes === 0;
  const entityTypes = data ? Object.entries(data.entity_types) : [];

  return (
    <section className={`mb-6 ${cardClass}`}>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
          <Icon name="graph" size={17} className="text-indigo-500 dark:text-indigo-400" />
          Graph overview
        </h2>
        <button
          type="button"
          onClick={stats.reload}
          disabled={stats.loading}
          className={secondaryButtonClass}
        >
          {stats.loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
        What's currently in the Neo4j knowledge graph. Updates after you build or
        remove a document below.
      </p>

      {stats.error && <StatusLine isError>{stats.error}</StatusLine>}

      {data && !stats.error && (
        <>
          {isEmpty ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              The graph is empty — build a document from some text in{" "}
              <span className="font-medium">Extract &amp; Build</span> below to
              populate it.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatTile label="entities" value={data.entities} />
                <StatTile label="relationships" value={data.relationships} />
                <StatTile label="documents" value={data.documents} />
                <StatTile label="total nodes" value={data.nodes} />
              </div>
              {entityTypes.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                    Entities by type
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {entityTypes.map(([label, count]) => (
                      <span
                        key={label}
                        className="inline-block rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300"
                      >
                        {label} <span className="opacity-70">{count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

function ExtractAndBuildCard({
  token,
  onBuilt,
}: {
  token: string;
  onBuilt: (doc: BuiltDoc) => void;
}) {
  const titleId = useId();
  const textId = useId();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ExtractResponse | null>(null);
  const [built, setBuilt] = useState<ConstructResponse | null>(null);

  async function handlePreview() {
    if (!text.trim()) {
      setStatus("Text is required.");
      setIsError(true);
      return;
    }
    setBusy(true);
    setStatus("Extracting…");
    setIsError(false);
    setPreview(null);
    setBuilt(null);
    try {
      const res = await apiFetch<ExtractResponse>("/v1/graph-rag/extract", {
        method: "POST",
        body: { text, extract_relationships: true },
        token,
      });
      setPreview(res);
      setStatus("");
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    } finally {
      setBusy(false);
    }
  }

  async function handleBuild() {
    if (!text.trim()) {
      setStatus("Text is required.");
      setIsError(true);
      return;
    }
    setBusy(true);
    setStatus("Building knowledge graph…");
    setIsError(false);
    setBuilt(null);
    try {
      const documentId = randomId();
      const res = await apiFetch<ConstructResponse>("/v1/graph-rag/construct-graph", {
        method: "POST",
        body: {
          document_id: documentId,
          text,
          title: title || "Untitled",
          source: "client-graph-explorer",
          extract_relationships: true,
        },
        token,
      });
      setBuilt(res);
      onBuilt({
        documentId: res.document_id,
        title: title || "Untitled",
        entityCount: res.entity_count,
        relationshipCount: res.relationship_count,
      });
      setStatus("");
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`mb-6 ${cardClass}`}>
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
        <Icon name="wand" size={16} className="text-indigo-500 dark:text-indigo-400" />
        Extract &amp; Build
      </h2>
      <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
        Paste text to see what entities and relationships spaCy finds in it —
        preview first (nothing saved), or build it straight into the Neo4j
        knowledge graph.
      </p>
      <fieldset disabled={!token} className="flex flex-col gap-3">
        <div>
          <label
            htmlFor={titleId}
            className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Title (optional, only used when building)
          </label>
          <input
            id={titleId}
            className={inputClass}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Q3 board meeting notes"
          />
        </div>
        <div>
          <label
            htmlFor={textId}
            className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Text
          </label>
          <textarea
            id={textId}
            className={inputClass}
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste a paragraph or two mentioning people, places, organizations…"
          />
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={handlePreview} disabled={busy} className={secondaryButtonClass}>
            Preview extraction
          </button>
          <button type="button" onClick={handleBuild} disabled={busy} className={primaryButtonClass}>
            Build knowledge graph
          </button>
          <StatusLine isError={isError}>{status}</StatusLine>
        </div>
      </fieldset>

      {preview && (
        <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-800">
          <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
            {preview.entity_count} entities, {preview.relationship_count} relationships found
            — nothing saved yet.
          </p>
          {preview.entities.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              No entities found — try a longer passage with named people, places, or organizations.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {preview.entities.map((e, i) => (
                <EntityBadge key={i} entity={e} />
              ))}
            </div>
          )}
          {preview.relationships.length > 0 && (
            <ul className="mt-2 flex flex-col gap-0.5 text-xs text-gray-600 dark:text-gray-400">
              {preview.relationships.map((r, i) => (
                <li key={i}>
                  {r.source} —[{r.type}]→ {r.target}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {built && (
        <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-100">
          <Icon name="check" size={14} className="mr-1 inline align-[-2px]" />
          {built.message} — {built.entity_count} entities, {built.relationship_count}{" "}
          relationships written. Document id: <code>{built.document_id}</code>
        </div>
      )}
    </section>
  );
}

function ExploreCard({ token }: { token: string }) {
  const [mode, setMode] = useState<"search" | "find" | "entity">("search");
  const [query, setQuery] = useState("");
  const [findQuery, setFindQuery] = useState("");
  const [entityText, setEntityText] = useState("");
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  // #1216: how many graph hops "Search" traverses (backend traversal_depth,
  // 1-4). Was hardcoded to 2; deeper reaches more distant entities at more
  // noise/latency. The result-count limits + entity-context knobs below were
  // likewise hardcoded (10 / 20 / window 5 / neighbors on).
  const [traversalDepth, setTraversalDepth] = useState(2);
  const [retrieveLimit, setRetrieveLimit] = useState(10);
  const [searchLimit, setSearchLimit] = useState(20);
  const [contextWindow, setContextWindow] = useState(5);
  const [includeNeighbors, setIncludeNeighbors] = useState(true);
  const [retrieveResult, setRetrieveResult] = useState<RetrieveResponse | null>(null);
  const [findResult, setFindResult] = useState<GraphSearchResponse | null>(null);
  const [contextResult, setContextResult] = useState<EntityContextResponse | null>(null);

  async function handleFind() {
    if (!findQuery.trim()) {
      setStatus("Search text is required.");
      setIsError(true);
      return;
    }
    setBusy(true);
    setStatus("Finding entities…");
    setIsError(false);
    setFindResult(null);
    try {
      const res = await apiFetch<GraphSearchResponse>("/v1/graph-rag/graph/search", {
        method: "POST",
        body: { query: findQuery, limit: searchLimit },
        token,
      });
      setFindResult(res);
      setStatus("");
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    } finally {
      setBusy(false);
    }
  }

  async function handleSearch() {
    if (!query.trim()) {
      setStatus("Query is required.");
      setIsError(true);
      return;
    }
    setBusy(true);
    setStatus("Searching…");
    setIsError(false);
    setRetrieveResult(null);
    try {
      const res = await apiFetch<RetrieveResponse>("/v1/graph-rag/retrieve", {
        method: "POST",
        body: { query, limit: retrieveLimit, traversal_depth: traversalDepth },
        token,
      });
      setRetrieveResult(res);
      setStatus("");
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    } finally {
      setBusy(false);
    }
  }

  async function handleEntityLookup() {
    if (!entityText.trim()) {
      setStatus("Entity name is required.");
      setIsError(true);
      return;
    }
    setBusy(true);
    setStatus("Looking up…");
    setIsError(false);
    setContextResult(null);
    try {
      const res = await apiFetch<EntityContextResponse>("/v1/graph-rag/entity-context", {
        method: "POST",
        body: {
          entity_text: entityText,
          include_neighbors: includeNeighbors,
          context_window: contextWindow,
        },
        token,
      });
      setContextResult(res);
      setStatus("");
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`mb-6 ${cardClass}`}>
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
        <Icon name="search" size={16} className="text-indigo-500 dark:text-indigo-400" />
        Explore
      </h2>
      <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
        Search the graph by meaning, find entities by name, or look up a specific
        entity's neighbors and source documents — a different retrieval path from
        RAG Pipelines' vector search, over the same underlying knowledge.
      </p>
      <div className="mb-3 flex gap-2 border-b border-gray-100 dark:border-gray-800">
        <button
          type="button"
          onClick={() => setMode("search")}
          className={`border-b-2 pb-1.5 text-sm font-medium ${
            mode === "search"
              ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
              : "border-transparent text-gray-500 dark:text-gray-400"
          }`}
        >
          Search
        </button>
        <button
          type="button"
          onClick={() => setMode("find")}
          className={`border-b-2 pb-1.5 text-sm font-medium ${
            mode === "find"
              ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
              : "border-transparent text-gray-500 dark:text-gray-400"
          }`}
        >
          Find entities
        </button>
        <button
          type="button"
          onClick={() => setMode("entity")}
          className={`border-b-2 pb-1.5 text-sm font-medium ${
            mode === "entity"
              ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
              : "border-transparent text-gray-500 dark:text-gray-400"
          }`}
        >
          Entity lookup
        </button>
      </div>

      <fieldset disabled={!token}>
        {mode === "search" && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${inputClass} min-w-48 flex-1`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="What are you looking for?"
              aria-label="Search the knowledge graph"
            />
            <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400">
              Depth
              <select
                value={traversalDepth}
                onChange={(e) => setTraversalDepth(Number(e.target.value))}
                className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                aria-label="Graph traversal depth"
              >
                <option value={1}>1 hop</option>
                <option value={2}>2 hops</option>
                <option value={3}>3 hops</option>
                <option value={4}>4 hops</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400">
              Results
              <input
                type="number"
                min={1}
                max={100}
                value={retrieveLimit}
                onChange={(e) => setRetrieveLimit(Number(e.target.value))}
                className="w-16 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                aria-label="Max results"
              />
            </label>
            <button type="button" onClick={handleSearch} disabled={busy} className={primaryButtonClass}>
              Search
            </button>
          </div>
        )}
        {mode === "find" && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${inputClass} min-w-48 flex-1`}
              value={findQuery}
              onChange={(e) => setFindQuery(e.target.value)}
              placeholder="Match entity name or type (e.g. 'tesla', 'PERSON')"
              aria-label="Find entities by name or label"
            />
            <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400">
              Results
              <input
                type="number"
                min={1}
                max={50}
                value={searchLimit}
                onChange={(e) => setSearchLimit(Number(e.target.value))}
                className="w-16 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                aria-label="Max matches"
              />
            </label>
            <button type="button" onClick={handleFind} disabled={busy} className={primaryButtonClass}>
              Find
            </button>
          </div>
        )}
        {mode === "entity" && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${inputClass} min-w-48 flex-1`}
              value={entityText}
              onChange={(e) => setEntityText(e.target.value)}
              placeholder="e.g. a person or company name"
              aria-label="Entity name to look up"
            />
            <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400">
              Context
              <input
                type="number"
                min={1}
                max={10}
                value={contextWindow}
                onChange={(e) => setContextWindow(Number(e.target.value))}
                className="w-16 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                aria-label="Context window"
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={includeNeighbors}
                onChange={(e) => setIncludeNeighbors(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300"
              />
              Neighbors
            </label>
            <button type="button" onClick={handleEntityLookup} disabled={busy} className={primaryButtonClass}>
              Look up
            </button>
          </div>
        )}
      </fieldset>
      <StatusLine isError={isError}>{status}</StatusLine>

      {mode === "search" && retrieveResult && (
        <div className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-800">
          <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
            {retrieveResult.entity_count} related entities · {Math.round(retrieveResult.retrieval_time_ms)}ms
          </p>
          {retrieveResult.related_entities.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Nothing found — the graph may not have any documents built yet (see Extract &amp; Build above).
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {retrieveResult.related_entities.map((e, i) => (
                <EntityBadge key={i} entity={e} />
              ))}
            </div>
          )}
        </div>
      )}

      {mode === "find" && findResult && (
        <div className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-800">
          <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
            {findResult.entity_count} matching{" "}
            {findResult.entity_count === 1 ? "entity" : "entities"}
          </p>
          {findResult.entities.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              No entities match — try a shorter term, or build a document first
              (see Extract &amp; Build above).
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {findResult.entities.map((e, i) => (
                <EntityBadge key={i} entity={e} />
              ))}
            </div>
          )}
        </div>
      )}

      {mode === "entity" && contextResult && (
        <div className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-800">
          {Object.keys(contextResult.entity).length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Entity not found in the graph.
            </p>
          ) : (
            <>
              <p className="mb-1 font-medium text-gray-900 dark:text-gray-100">
                {entityText}
              </p>
              {contextResult.related_entities.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {contextResult.related_entities.map((e, i) => (
                    <EntityBadge key={i} entity={e} />
                  ))}
                </div>
              )}
              {contextResult.documents.length > 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Mentioned in: {contextResult.documents.map((d) => d.title || d.id).join(", ")}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function DeleteDocumentCard({
  token,
  confirm,
  graphDocs,
  onDeleted,
}: {
  token: string;
  confirm: ReturnType<typeof useConfirm>["confirm"];
  graphDocs: AsyncResource<GraphDocumentsResponse>;
  onDeleted: (documentId: string) => void;
}) {
  const [documentId, setDocumentId] = useState("");
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const documents = graphDocs.data?.documents ?? [];

  async function handleDelete() {
    if (!documentId.trim()) {
      setStatus("Document id is required.");
      setIsError(true);
      return;
    }
    const ok = await confirm({
      title: "Remove document from graph?",
      message: `This permanently removes document "${documentId}"'s relationships and any entities that only it referenced from Neo4j. Entities shared with other documents are kept.`,
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setStatus("Deleting…");
    setIsError(false);
    try {
      await apiFetch(`/v1/graph-rag/graph/document/${encodeURIComponent(documentId)}`, {
        method: "DELETE",
        token,
      });
      setStatus("Deleted (idempotent — reports success even if the id was already gone).");
      onDeleted(documentId);
      setDocumentId("");
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`mb-6 ${cardClass}`}>
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
        <Icon name="delete" size={16} className="text-indigo-500 dark:text-indigo-400" />
        Remove a document's graph
      </h2>
      <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
        Removes one document's relationships and orphaned entities from
        Neo4j (entities shared with other documents are kept). Pick one from the
        graph below, or paste any document id.
      </p>
      <div className="mb-3 flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
            In the graph{graphDocs.data ? ` (${graphDocs.data.count})` : ""}:
          </p>
          <button
            type="button"
            onClick={graphDocs.reload}
            disabled={graphDocs.loading}
            className="text-xs text-indigo-600 hover:underline disabled:opacity-50 dark:text-indigo-400"
          >
            {graphDocs.loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {graphDocs.error ? (
          <StatusLine isError>{graphDocs.error}</StatusLine>
        ) : documents.length === 0 ? (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {graphDocs.loading
              ? "Loading…"
              : "No documents in the graph yet — build one from text above."}
          </p>
        ) : (
          <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
            {documents.map((doc) => (
              <li key={doc.id}>
                <button
                  type="button"
                  onClick={() => setDocumentId(doc.id)}
                  className={`text-left text-xs hover:underline ${
                    documentId === doc.id
                      ? "font-medium text-indigo-700 dark:text-indigo-300"
                      : "text-indigo-600 dark:text-indigo-400"
                  }`}
                >
                  {doc.title || doc.source || "Untitled"} — {doc.entity_count} entities{" "}
                  <code className="text-gray-500 dark:text-gray-400">({doc.id || "—"})</code>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <fieldset disabled={!token} className="flex items-center gap-2">
        <input
          className={inputClass}
          aria-label="Document id"
          value={documentId}
          onChange={(e) => setDocumentId(e.target.value)}
          placeholder="document id"
        />
        <button type="button" onClick={handleDelete} disabled={busy} className={destructiveButtonClass}>
          Delete
        </button>
      </fieldset>
      <StatusLine isError={isError}>{status}</StatusLine>
    </section>
  );
}

function DocumentVisibilityRow({
  doc,
  token,
  myTeams,
  onUpdated,
}: {
  doc: GraphDocument;
  token: string;
  myTeams: TeamOption[];
  onUpdated: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [visibility, setVisibility] = useState<"private" | "team" | "shared">(
    doc.visibility ?? "private",
  );
  const [teamId, setTeamId] = useState<number | "">(doc.team_id ?? "");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);

  function startEdit() {
    setVisibility(doc.visibility ?? "private");
    setTeamId(doc.team_id ?? "");
    setStatus("");
    setIsError(false);
    setEditing(true);
  }

  async function handleSave() {
    if (visibility === "team" && teamId === "") {
      setStatus("Choose a team to share this document with.");
      setIsError(true);
      return;
    }
    setSaving(true);
    setStatus("Saving…");
    setIsError(false);
    try {
      await apiFetch(`/v1/graph-rag/graph/document/${encodeURIComponent(doc.id)}`, {
        method: "PATCH",
        body: { visibility, team_id: visibility === "team" ? teamId : null },
        token,
      });
      setEditing(false);
      onUpdated();
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    } finally {
      setSaving(false);
    }
  }

  const visibilityLabel =
    doc.visibility === "team"
      ? `👥 Team${
          myTeams.find((t) => t.id === doc.team_id)
            ? `: ${myTeams.find((t) => t.id === doc.team_id)!.name}`
            : ""
        }`
      : doc.visibility === "shared"
        ? "🌐 Shared"
        : "🔒 Private";

  return (
    <li className="flex flex-col gap-1 border-b border-gray-100 py-1.5 last:border-0 dark:border-gray-800">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-gray-700 dark:text-gray-300">
          {doc.title || doc.source || "Untitled"}{" "}
          <code className="text-gray-500 dark:text-gray-400">({doc.id})</code>
        </span>
        {!editing && (
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {visibilityLabel}
            </span>
            <button
              type="button"
              onClick={startEdit}
              disabled={!token}
              className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline disabled:opacity-50 dark:text-indigo-400"
            >
              <Icon name="edit" size={12} />
              Edit
            </button>
          </div>
        )}
      </div>
      {editing && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={inputClass}
            value={visibility}
            onChange={(e) =>
              setVisibility(e.target.value as "private" | "team" | "shared")
            }
            disabled={saving}
            aria-label={`Visibility for ${doc.title || doc.id}`}
          >
            <option value="private">🔒 Private (only me)</option>
            <option value="team">👥 Team</option>
            <option value="shared">🌐 Shared (everyone)</option>
          </select>
          {visibility === "team" && (
            <select
              className={inputClass}
              value={teamId}
              onChange={(e) => setTeamId(Number(e.target.value))}
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
          <button
            type="button"
            className={primaryButtonClass}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => setEditing(false)}
            disabled={saving}
          >
            Cancel
          </button>
        </div>
      )}
      {status && <StatusLine isError={isError}>{status}</StatusLine>}
    </li>
  );
}

function DocumentVisibilityCard({
  token,
  myTeams,
  graphDocs,
  onUpdated,
}: {
  token: string;
  myTeams: TeamOption[];
  graphDocs: AsyncResource<GraphDocumentsResponse>;
  onUpdated: () => void;
}) {
  const documents = graphDocs.data?.documents ?? [];

  return (
    <section className={`mb-6 ${cardClass}`}>
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
        <Icon name="eye" size={16} className="text-indigo-500 dark:text-indigo-400" />
        Document visibility
      </h2>
      <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
        Every document is private to you when built. Share one with your team
        or everyone here — the entities it exclusively mentions widen to
        match, and any correlations you run afterward can then surface across
        the shared audience too.
      </p>
      {graphDocs.error ? (
        <StatusLine isError>{graphDocs.error}</StatusLine>
      ) : documents.length === 0 ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {graphDocs.loading
            ? "Loading…"
            : "No documents in the graph yet — build one from text above."}
        </p>
      ) : (
        <ul className="flex max-h-64 flex-col overflow-y-auto">
          {documents.map((doc) => (
            <DocumentVisibilityRow
              key={doc.id}
              doc={doc}
              token={token}
              myTeams={myTeams}
              onUpdated={onUpdated}
            />
          ))}
        </ul>
      )}
      {!token && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Log in to change a document's visibility.
        </p>
      )}
    </section>
  );
}

function CorrelationItemList({
  items,
  weightKey,
}: {
  items: CorrelationItem[];
  weightKey: "count" | "score" | null;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it, i) => {
        const weight = weightKey ? it[weightKey] : undefined;
        return (
          <span
            key={i}
            className="inline-block rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300"
          >
            {it.text}
            {it.label && <span className="ml-1 opacity-70">({it.label})</span>}
            {weight != null && (
              <span className="ml-1 opacity-70">{String(weight)}</span>
            )}
            {typeof it.hops === "number" && (
              <span className="ml-1 opacity-70">
                {it.hops} hop{it.hops === 1 ? "" : "s"}
                {it.via && it.via.length > 0 ? ` via ${it.via.join("→")}` : ""}
              </span>
            )}
            {typeof it.centrality_score === "number" && (
              <span className="ml-1 opacity-70">c {it.centrality_score.toFixed(2)}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

// #1216: the correlation engine's registered correlators (graph-rag
// core/correlation/*). "Run correlation" can run a subset instead of all — e.g.
// just the cheap co_occurrence pass, skipping the ones that make live Ollama
// embedding calls.
const CORRELATORS = [
  "co_occurrence",
  "embedding_neighbour",
  "entity_resolution",
  "entity_signal",
  "taxonomy",
  "temporal",
] as const;

function CorrelationsCard({ token }: { token: string }) {
  const entityId = useId();
  const [entity, setEntity] = useState("");
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [runResult, setRunResult] = useState<CorrelateRunResult | null>(null);
  const [result, setResult] = useState<CorrelationsResult | null>(null);
  // #1214: expose the two shipped-but-hidden correlation analytics — bounded
  // multi-hop discovery (max_hops) and degree-centrality scoring.
  const [maxHops, setMaxHops] = useState(1);
  const [includeCentrality, setIncludeCentrality] = useState(false);
  // #1216: which correlators "Run correlation" runs. All selected by default =
  // run everything (send {} so the backend picks its own default set); a strict
  // subset sends `correlators`.
  const [selectedCorrelators, setSelectedCorrelators] = useState<Set<string>>(
    () => new Set(CORRELATORS),
  );

  function toggleCorrelator(name: string) {
    setSelectedCorrelators((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function handleRun() {
    setBusy(true);
    setStatus("Running correlation…");
    setIsError(false);
    setRunResult(null);
    try {
      // Send a subset only when the user has narrowed it; all-selected (or the
      // degenerate none-selected) sends {} so the backend runs its full set.
      const subset =
        selectedCorrelators.size > 0 && selectedCorrelators.size < CORRELATORS.length
          ? { correlators: CORRELATORS.filter((c) => selectedCorrelators.has(c)) }
          : {};
      const res = await apiFetch<CorrelateRunResult>(
        "/v1/graph-rag/graph/correlate",
        { method: "POST", body: subset, token },
      );
      setRunResult(res);
      setStatus("");
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    } finally {
      setBusy(false);
    }
  }

  async function handleFind() {
    if (!entity.trim()) {
      setStatus("Entity name is required.");
      setIsError(true);
      return;
    }
    setBusy(true);
    setStatus("Finding correlations…");
    setIsError(false);
    setResult(null);
    try {
      const res = await apiFetch<CorrelationsResult>(
        `/v1/graph-rag/graph/correlations?entity=${encodeURIComponent(entity)}&limit=10` +
          `&max_hops=${maxHops}&include_centrality=${includeCentrality}`,
        { token },
      );
      setResult(res);
      setStatus("");
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    } finally {
      setBusy(false);
    }
  }

  const hasAny =
    result != null &&
    result.found &&
    (result.co_occurring.length > 0 ||
      result.similar.length > 0 ||
      result.same_as.length > 0 ||
      result.correlated_signals.length > 0 ||
      (result.indirect?.length ?? 0) > 0);

  return (
    <section className={`mb-6 ${cardClass}`}>
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
        <Icon name="link" size={16} className="text-indigo-500 dark:text-indigo-400" />
        Correlations
      </h2>
      <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
        Discover relationships across your graph — entities that co-occur, mean
        the same thing, are semantically similar, or whose quantitative signals
        move together (cross-modal). Run correlation to (re)build the edges, then
        look up an entity to see what it's connected to.
      </p>
      <fieldset disabled={!token} className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleRun}
            disabled={busy}
            className={secondaryButtonClass}
          >
            Run correlation
          </button>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Builds correlation edges over your graph (owner-scoped).
          </span>
        </div>
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100">
            <Icon name="chevron-right" size={13} className="transition group-open:rotate-90" />
            Correlators to run
            {selectedCorrelators.size < CORRELATORS.length && (
              <span className="text-indigo-600 dark:text-indigo-400">
                ({selectedCorrelators.size}/{CORRELATORS.length})
              </span>
            )}
          </summary>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
            {CORRELATORS.map((c) => (
              <label
                key={c}
                className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300"
              >
                <input
                  type="checkbox"
                  checked={selectedCorrelators.has(c)}
                  onChange={() => toggleCorrelator(c)}
                  className="h-3.5 w-3.5 rounded border-gray-300"
                />
                {c}
              </label>
            ))}
          </div>
        </details>
        <div>
          <label
            htmlFor={entityId}
            className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Look up an entity's correlations
          </label>
          <div className="flex gap-2">
            <input
              id={entityId}
              className={inputClass}
              value={entity}
              onChange={(e) => setEntity(e.target.value)}
              placeholder="e.g. a person, company, or concept"
              aria-label="Entity name to find correlations"
            />
            <button
              type="button"
              onClick={handleFind}
              disabled={busy}
              className={primaryButtonClass}
            >
              Find correlations
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400">
              Depth
              <select
                value={maxHops}
                onChange={(e) => setMaxHops(Number(e.target.value))}
                className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                aria-label="Correlation traversal depth (max hops)"
              >
                <option value={1}>Direct only</option>
                <option value={2}>+ 2 hops (indirect)</option>
                <option value={3}>+ 3 hops (indirect)</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={includeCentrality}
                onChange={(e) => setIncludeCentrality(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300"
              />
              Show centrality scores
            </label>
          </div>
          <p className={fieldHintClass}>
            Depth &gt; 1 also surfaces bounded multi-hop (indirect) links.
            Centrality is a 0–1 degree score — how connected each entity is.
          </p>
        </div>
      </fieldset>
      <StatusLine isError={isError}>{status}</StatusLine>

      {runResult && (
        <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-800">
          <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">
            Correlation run complete:
          </p>
          <ul className="flex flex-col gap-0.5 text-xs text-gray-700 dark:text-gray-300">
            {runResult.results.map((r) => (
              <li key={r.correlator}>
                {r.correlator}: <span className="font-medium">{r.edges}</span> edges
              </li>
            ))}
          </ul>
          {runResult.skipped.length > 0 && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Skipped (unavailable): {runResult.skipped.join(", ")}
            </p>
          )}
        </div>
      )}

      {result && !result.found && (
        <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-800">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            "{result.entity}" isn't in your graph yet — build a document that
            mentions it (Extract &amp; Build above), then run correlation.
          </p>
        </div>
      )}

      {result?.found && !hasAny && (
        <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-800">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            No correlations found for "{result.entity}" yet — try Run correlation
            first, or add more documents so patterns can emerge.
          </p>
        </div>
      )}

      {hasAny && result && (
        <div className="mt-3 flex flex-col gap-3 rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-800">
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
            Correlations for "{result.entity}"
            {typeof result.entity_centrality_score === "number" && (
              <span className="ml-1.5 font-normal text-gray-500 dark:text-gray-400">
                · centrality {result.entity_centrality_score.toFixed(2)}
              </span>
            )}
          </p>
          {result.co_occurring.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                Co-occurs with (count)
              </p>
              <CorrelationItemList items={result.co_occurring} weightKey="count" />
            </div>
          )}
          {result.similar.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                Semantically similar (score)
              </p>
              <CorrelationItemList items={result.similar} weightKey="score" />
            </div>
          )}
          {result.same_as.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                Same as (resolved variants)
              </p>
              <CorrelationItemList items={result.same_as} weightKey={null} />
            </div>
          )}
          {(result.indirect?.length ?? 0) > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                Indirect (multi-hop reach)
              </p>
              <CorrelationItemList items={result.indirect ?? []} weightKey={null} />
            </div>
          )}
          {result.correlated_signals.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                Cross-modal: signals that move together
              </p>
              <ul className="flex flex-col gap-0.5 text-xs text-gray-600 dark:text-gray-400">
                {result.correlated_signals.map((s, i) => (
                  <li key={i}>
                    {s.signal} ↔ {s.correlated_with}{" "}
                    <span className="opacity-70">
                      (coef {typeof s.coef === "number" ? s.coef.toFixed(2) : s.coef})
                    </span>
                    {s.entities.length > 0 && (
                      <span className="opacity-70">
                        {" "}
                        — {s.entities.join(", ")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function GraphExplorerPage() {
  const { token } = useAuth();
  const { confirm, dialog } = useConfirm();
  const [myTeams, setMyTeams] = useState<TeamOption[]>([]);

  // Whole-graph overview + the document list, lifted here so a build/delete
  // below can reload() them — the overview counts and the document browser then
  // reflect the change without a manual refresh. #502. Both are JWT-gated
  // (owner-scoped under tenancy — 401 without a token, NOT open reads as an
  // earlier comment claimed), so pass the token and re-fetch when it changes;
  // otherwise a logged-in user's overview + documents silently 401.
  const stats = useAsyncResource<GraphStats>(
    (signal) => apiFetch<GraphStats>("/v1/graph-rag/graph/stats", { signal, token }),
    { deps: [token] },
  );
  const graphDocs = useAsyncResource<GraphDocumentsResponse>(
    (signal) =>
      apiFetch<GraphDocumentsResponse>("/v1/graph-rag/graph/documents", {
        signal,
        token,
      }),
    { deps: [token] },
  );

  function handleChanged() {
    stats.reload();
    graphDocs.reload();
  }

  useEffect(() => {
    if (!token) {
      setMyTeams([]);
      return;
    }
    // Same "list every team, let sharing with a non-member team fail
    // server-side" convention as KnowledgeBasesPage -- no "my teams" filter
    // endpoint exists yet.
    apiFetch<{ teams: TeamOption[] }>("/v1/teams?limit=500", { token })
      .then((res) => setMyTeams(res.teams))
      .catch(() => setMyTeams([]));
  }, [token]);

  return (
    <>
      <PageHeader
        icon="graph"
        title="Knowledge Graph"
        subtitle={
          <>
            Build and explore a knowledge graph from your text — spaCy extracts
            entities and relationships, Neo4j stores them. A different retrieval
            paradigm from vector-search RAG Pipelines: this finds{" "}
            <em>who's connected to whom</em>, not just similar-sounding chunks.
          </>
        }
      />
      <InfoCallout icon="info">
        This graph is separate from the plugin dependency graph shown on the
        Marketplace page — same underlying Neo4j instance, unrelated data.
      </InfoCallout>
      {dialog}
      <GraphOverviewCard stats={stats} />
      <ExtractAndBuildCard token={token} onBuilt={handleChanged} />
      <ExploreCard token={token} />
      <CorrelationsCard token={token} />
      <DocumentVisibilityCard
        token={token}
        myTeams={myTeams}
        graphDocs={graphDocs}
        onUpdated={handleChanged}
      />
      <DeleteDocumentCard
        token={token}
        confirm={confirm}
        graphDocs={graphDocs}
        onDeleted={handleChanged}
      />
    </>
  );
}
