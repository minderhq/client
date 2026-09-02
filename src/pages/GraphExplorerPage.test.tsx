import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GraphExplorerPage } from "./GraphExplorerPage";

let statsResult: Record<string, unknown> = {
  success: true,
  nodes: 0,
  relationships: 0,
  documents: 0,
  entities: 0,
  entity_types: {},
};
let documentsResult: Record<string, unknown> = { success: true, documents: [], count: 0 };
let extractBehavior: () => Promise<unknown>;
let buildBehavior: () => Promise<unknown>;
let deleteBehavior: () => Promise<unknown>;
let visibilityBehavior: () => Promise<unknown>;
let statsBehavior: (() => Promise<unknown>) | null = null;
let lastDeletePath: string | undefined;
let lastVisibilityPath: string | undefined;
let lastVisibilityOpts: { body?: { visibility?: string; team_id?: number | null } } | undefined;
let myTeamsResult: { id: number; name: string }[] = [];
const confirmMock = vi.fn();

// The three retrieval modes (Search/Find entities/Entity lookup, #701) each
// hit a different endpoint -- each has its own overridable behavior so a
// test can inject a rejection without disturbing the other two, and its own
// captured request options to assert the right query/body was sent.
let searchBehavior: () => Promise<unknown>;
let retrieveBehavior: () => Promise<unknown>;
let entityBehavior: () => Promise<unknown>;
let correlateBehavior: () => Promise<unknown>;
let correlationsBehavior: () => Promise<unknown>;
let lastSearchOpts: { body?: { query?: string; limit?: number } } | undefined;
let lastRetrieveOpts:
  | { body?: { query?: string; traversal_depth?: number; limit?: number } }
  | undefined;
let lastEntityOpts:
  | {
      body?: {
        entity_text?: string;
        context_window?: number;
        include_neighbors?: boolean;
      };
    }
  | undefined;
let lastCorrelateOpts: { body?: { correlators?: string[] } } | undefined;
let lastCorrelationsPath: string | undefined;

function resetBehaviors() {
  searchBehavior = async () => ({
    success: true,
    query: "tesla",
    entities: [
      { text: "Tesla", label: "ORG" },
      { text: "Tesla Model 3", label: "PRODUCT" },
    ],
    entity_count: 2,
  });
  retrieveBehavior = async () => ({
    success: true,
    query: "who runs tesla",
    related_entities: [{ text: "Elon Musk" }],
    entity_count: 1,
    retrieval_time_ms: 12,
  });
  entityBehavior = async () => ({
    success: true,
    entity: { text: "Elon Musk", label: "PERSON" },
    related_entities: [{ text: "Tesla" }],
    documents: [{ id: "d1", title: "bio.txt" }],
    context_window: 5,
  });
  extractBehavior = async () => ({
    success: true,
    entities: [{ text: "Tesla", label: "ORG" }],
    relationships: [{ source: "Tesla", type: "FOUNDED_BY", target: "Elon Musk" }],
    entity_count: 1,
    relationship_count: 1,
  });
  buildBehavior = async () => ({
    success: true,
    message: "Graph built",
    document_id: "doc-1",
    entity_count: 3,
    relationship_count: 2,
  });
  deleteBehavior = async () => ({ success: true });
  visibilityBehavior = async () => ({
    success: true,
    document_id: "doc-1",
    visibility: "team",
    team_id: 7,
  });
  correlateBehavior = async () => ({
    success: true,
    results: [
      { correlator: "co_occurrence", edges: 6 },
      { correlator: "embedding_neighbour", edges: 2 },
    ],
    skipped: [],
  });
  correlationsBehavior = async () => ({
    success: true,
    entity: "Elon Musk",
    found: true,
    co_occurring: [{ text: "SpaceX", label: "ORG", count: 4 }],
    similar: [{ text: "Musk", label: "PERSON", score: 0.82 }],
    same_as: [{ text: "elon musk", label: "PERSON" }],
    correlated_signals: [
      {
        signal: "crypto_price:BTC-USD",
        correlated_with: "crypto_price:ETH-USD",
        coef: 0.95,
        entities: ["ETH-USD"],
      },
    ],
  });
}
resetBehaviors();

const apiFetch = vi.fn(async (path: string, opts?: unknown) => {
  if (path.includes("/graph/stats")) return statsBehavior ? statsBehavior() : statsResult;
  if (path.includes("/graph/documents")) return documentsResult;
  if (path.includes("/v1/teams")) return { teams: myTeamsResult };
  if (path.includes("/graph/search")) {
    lastSearchOpts = opts as typeof lastSearchOpts;
    return searchBehavior();
  }
  if (path.includes("/retrieve")) {
    lastRetrieveOpts = opts as typeof lastRetrieveOpts;
    return retrieveBehavior();
  }
  if (path.includes("/entity-context")) {
    lastEntityOpts = opts as typeof lastEntityOpts;
    return entityBehavior();
  }
  if (path.includes("/graph/correlations")) {
    lastCorrelationsPath = path;
    return correlationsBehavior();
  }
  if (path.includes("/graph/correlate")) {
    lastCorrelateOpts = opts as typeof lastCorrelateOpts;
    return correlateBehavior();
  }
  if (path.includes("/extract")) return extractBehavior();
  if (path.includes("/construct-graph")) return buildBehavior();
  if (path.includes("/graph/document/")) {
    const method = (opts as { method?: string } | undefined)?.method;
    if (method === "PATCH") {
      lastVisibilityPath = path;
      lastVisibilityOpts = opts as typeof lastVisibilityOpts;
      return visibilityBehavior();
    }
    lastDeletePath = path;
    return deleteBehavior();
  }
  return {};
});

vi.mock("../lib/api", () => ({
  apiFetch: (path: string, opts?: unknown) => apiFetch(path, opts),
  friendlyErrorMessage: (e: unknown) => String(e),
}));
vi.mock("../lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));
vi.mock("../components/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: confirmMock, dialog: null }),
}));

afterEach(() => {
  cleanup();
  apiFetch.mockClear();
  confirmMock.mockReset();
  statsBehavior = null;
  lastSearchOpts = lastRetrieveOpts = lastEntityOpts = lastDeletePath = undefined;
  lastCorrelateOpts = undefined;
  lastCorrelationsPath = undefined;
  lastVisibilityPath = lastVisibilityOpts = undefined;
  myTeamsResult = [];
  statsResult = {
    success: true,
    nodes: 0,
    relationships: 0,
    documents: 0,
    entities: 0,
    entity_types: {},
  };
  documentsResult = { success: true, documents: [], count: 0 };
  resetBehaviors();
});

describe("GraphExplorerPage — Find entities (graph search)", () => {
  it("searches the graph for entities and renders the matches", async () => {
    render(<GraphExplorerPage />);

    fireEvent.click(screen.getByRole("button", { name: "Find entities" }));
    fireEvent.change(
      screen.getByLabelText("Find entities by name or label"),
      { target: { value: "tesla" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Find" }));

    expect(await screen.findByText("Tesla")).toBeTruthy();
    expect(screen.getByText("Tesla Model 3")).toBeTruthy();
    await waitFor(() => expect(lastSearchOpts?.body?.query).toBe("tesla"));
  });

  it("shows an empty-state message when nothing matches", async () => {
    searchBehavior = async () => ({
      success: true,
      query: "zzz",
      entities: [],
      entity_count: 0,
    });
    render(<GraphExplorerPage />);
    fireEvent.click(screen.getByRole("button", { name: "Find entities" }));
    fireEvent.change(
      screen.getByLabelText("Find entities by name or label"),
      { target: { value: "zzz" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Find" }));

    expect(await screen.findByText(/No entities match/i)).toBeTruthy();
  });

  it("shows a friendly error when the search request fails", async () => {
    searchBehavior = async () => {
      throw new Error("graph-rag unreachable");
    };
    render(<GraphExplorerPage />);
    fireEvent.click(screen.getByRole("button", { name: "Find entities" }));
    fireEvent.change(
      screen.getByLabelText("Find entities by name or label"),
      { target: { value: "tesla" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Find" }));

    expect(await screen.findByText("Error: graph-rag unreachable")).toBeTruthy();
  });
});

describe("GraphExplorerPage — Search (graph-based retrieval)", () => {
  it("retrieves related entities for a query (default tab)", async () => {
    render(<GraphExplorerPage />);

    fireEvent.change(screen.getByLabelText("Search the knowledge graph"), {
      target: { value: "who runs tesla" },
    });
    // Two "Search" buttons exist simultaneously (the tab + the submit button,
    // since "search" is the default mode) -- the submit button is the last one.
    fireEvent.click(screen.getAllByRole("button", { name: "Search" }).at(-1)!);

    expect(await screen.findByText("Elon Musk")).toBeTruthy();
    await waitFor(() =>
      expect(lastRetrieveOpts?.body?.query).toBe("who runs tesla"),
    );
    // Default traversal depth is 2 hops.
    expect(lastRetrieveOpts?.body?.traversal_depth).toBe(2);
  });

  it("sends the chosen traversal depth (#1216)", async () => {
    render(<GraphExplorerPage />);

    fireEvent.change(screen.getByLabelText("Graph traversal depth"), {
      target: { value: "4" },
    });
    fireEvent.change(screen.getByLabelText("Search the knowledge graph"), {
      target: { value: "who runs tesla" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Search" }).at(-1)!);

    await waitFor(() =>
      expect(lastRetrieveOpts?.body?.traversal_depth).toBe(4),
    );
  });

  it("requires non-empty query text before calling the API", () => {
    render(<GraphExplorerPage />);
    fireEvent.click(screen.getAllByRole("button", { name: "Search" }).at(-1)!);

    expect(screen.getByText("Query is required.")).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalledWith(
      "/v1/graph-rag/retrieve",
      expect.anything(),
    );
  });

  it("shows a friendly error when the retrieve request fails", async () => {
    retrieveBehavior = async () => {
      throw new Error("neo4j unreachable");
    };
    render(<GraphExplorerPage />);
    fireEvent.change(screen.getByLabelText("Search the knowledge graph"), {
      target: { value: "who runs tesla" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Search" }).at(-1)!);

    expect(await screen.findByText("Error: neo4j unreachable")).toBeTruthy();
  });
});

describe("GraphExplorerPage — Entity lookup", () => {
  it("looks up an entity and renders its neighbors and documents", async () => {
    render(<GraphExplorerPage />);

    fireEvent.click(screen.getByRole("button", { name: "Entity lookup" }));
    fireEvent.change(screen.getByLabelText("Entity name to look up"), {
      target: { value: "Elon Musk" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Look up" }));

    await screen.findByText("Elon Musk"); // the looked-up entity's own name
    expect(screen.getByText("Tesla")).toBeTruthy(); // related entity
    expect(screen.getByText(/Mentioned in: bio.txt/)).toBeTruthy();
    await waitFor(() =>
      expect(lastEntityOpts?.body?.entity_text).toBe("Elon Musk"),
    );
  });

  it("shows 'Entity not found' for an empty entity result", async () => {
    entityBehavior = async () => ({
      success: true,
      entity: {},
      related_entities: [],
      documents: [],
      context_window: 5,
    });
    render(<GraphExplorerPage />);
    fireEvent.click(screen.getByRole("button", { name: "Entity lookup" }));
    fireEvent.change(screen.getByLabelText("Entity name to look up"), {
      target: { value: "Nobody" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Look up" }));

    expect(
      await screen.findByText("Entity not found in the graph."),
    ).toBeTruthy();
  });

  it("shows a friendly error when the entity-context request fails", async () => {
    entityBehavior = async () => {
      throw new Error("entity lookup failed");
    };
    render(<GraphExplorerPage />);
    fireEvent.click(screen.getByRole("button", { name: "Entity lookup" }));
    fireEvent.change(screen.getByLabelText("Entity name to look up"), {
      target: { value: "Elon Musk" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Look up" }));

    expect(await screen.findByText("Error: entity lookup failed")).toBeTruthy();
  });
});

describe("GraphExplorerPage — Graph overview", () => {
  it("shows the empty-graph message when there are zero nodes", async () => {
    render(<GraphExplorerPage />);
    expect(
      await screen.findByText(/The graph is empty — build a document/),
    ).toBeTruthy();
  });

  it("renders stat tiles and entity-type badges when the graph is non-empty", async () => {
    statsResult = {
      success: true,
      nodes: 12,
      relationships: 5,
      documents: 3,
      entities: 8,
      entity_types: { PERSON: 4, ORG: 2 },
    };
    render(<GraphExplorerPage />);

    expect(await screen.findByText("entities")).toBeTruthy();
    expect(screen.getByText("8")).toBeTruthy();
    expect(screen.getByText("relationships")).toBeTruthy();
    expect(screen.getByText("PERSON")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("ORG")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("reloads stats when Refresh is clicked", async () => {
    render(<GraphExplorerPage />);
    await screen.findByText(/The graph is empty/);
    apiFetch.mockClear();

    fireEvent.click(screen.getAllByRole("button", { name: "Refresh" })[0]);

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/v1/graph-rag/graph/stats",
        // The token must be passed — these are JWT-gated (owner-scoped), so a
        // tokenless fetch 401s and the overview silently fails to load.
        expect.objectContaining({ token: "test-token" }),
      ),
    );
  });

  it("shows a friendly error when the stats fetch fails", async () => {
    statsBehavior = async () => {
      throw new Error("graph-rag unreachable");
    };
    render(<GraphExplorerPage />);

    expect(await screen.findByText("Error: graph-rag unreachable")).toBeTruthy();
  });
});

describe("GraphExplorerPage — Extract & Build", () => {
  it("requires text before previewing or building", async () => {
    render(<GraphExplorerPage />);

    fireEvent.click(screen.getByRole("button", { name: "Preview extraction" }));
    expect(await screen.findByText("Text is required.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Build knowledge graph" }));
    expect(await screen.findByText("Text is required.")).toBeTruthy();
  });

  it("previews extracted entities and relationships without building anything", async () => {
    render(<GraphExplorerPage />);

    fireEvent.change(screen.getByLabelText("Text"), {
      target: { value: "Tesla was founded by Elon Musk." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview extraction" }));

    expect(
      await screen.findByText("1 entities, 1 relationships found — nothing saved yet."),
    ).toBeTruthy();
    expect(screen.getByText(/Tesla —\[FOUNDED_BY\]→ Elon Musk/)).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalledWith(
      "/v1/graph-rag/construct-graph",
      expect.anything(),
    );
  });

  it("shows a friendly error when preview extraction fails", async () => {
    extractBehavior = async () => {
      throw new Error("spaCy model not loaded");
    };
    render(<GraphExplorerPage />);

    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "some text" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview extraction" }));

    expect(await screen.findByText("Error: spaCy model not loaded")).toBeTruthy();
  });

  it("builds the graph, reports the result, and refreshes the overview/document list", async () => {
    render(<GraphExplorerPage />);
    apiFetch.mockClear();

    fireEvent.change(screen.getByLabelText("Text"), {
      target: { value: "Tesla was founded by Elon Musk." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Build knowledge graph" }));

    expect(await screen.findByText(/Graph built/)).toBeTruthy();
    expect(screen.getByText("doc-1")).toBeTruthy();
    // handleChanged() re-fetches both stats and the document list after a build.
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/v1/graph-rag/graph/stats",
        expect.objectContaining({}),
      ),
    );
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/v1/graph-rag/graph/documents",
        expect.objectContaining({}),
      ),
    );
  });

  it("shows a friendly error when build fails", async () => {
    buildBehavior = async () => {
      throw new Error("neo4j unreachable");
    };
    render(<GraphExplorerPage />);

    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "some text" } });
    fireEvent.click(screen.getByRole("button", { name: "Build knowledge graph" }));

    expect(await screen.findByText("Error: neo4j unreachable")).toBeTruthy();
  });
});

describe("GraphExplorerPage — Remove a document's graph", () => {
  it("lists documents in the graph and selects one into the id field on click", async () => {
    documentsResult = {
      success: true,
      documents: [
        { id: "doc-1", title: "Board notes", source: null, created_at: null, entity_count: 4 },
      ],
      count: 1,
    };
    render(<GraphExplorerPage />);

    const docButton = await screen.findByText(/Board notes — 4 entities/);
    fireEvent.click(docButton);

    expect((screen.getByLabelText("Document id") as HTMLInputElement).value).toBe("doc-1");
  });

  it("shows a fallback title/source when both are null", async () => {
    documentsResult = {
      success: true,
      documents: [
        { id: "", title: null, source: null, created_at: null, entity_count: 0 },
      ],
      count: 1,
    };
    render(<GraphExplorerPage />);

    expect(await screen.findByText(/Untitled — 0 entities/)).toBeTruthy();
    expect(screen.getByText("(—)")).toBeTruthy();
  });

  it("requires a document id before deleting", async () => {
    render(<GraphExplorerPage />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("Document id is required.")).toBeTruthy();
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("does not delete when the confirmation is declined", async () => {
    confirmMock.mockResolvedValue(false);
    render(<GraphExplorerPage />);

    fireEvent.change(screen.getByLabelText("Document id"), {
      target: { value: "doc-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(apiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/graph/document/"),
      expect.anything(),
    );
  });

  it("deletes the document once confirmed, reports success, and clears the field", async () => {
    confirmMock.mockResolvedValue(true);
    render(<GraphExplorerPage />);

    fireEvent.change(screen.getByLabelText("Document id"), {
      target: { value: "doc-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(
      await screen.findByText(/Deleted \(idempotent/),
    ).toBeTruthy();
    expect(lastDeletePath).toBe("/v1/graph-rag/graph/document/doc-1");
    expect((screen.getByLabelText("Document id") as HTMLInputElement).value).toBe("");
  });

  it("shows a friendly error when delete fails", async () => {
    confirmMock.mockResolvedValue(true);
    deleteBehavior = async () => {
      throw new Error("neo4j unreachable");
    };
    render(<GraphExplorerPage />);

    fireEvent.change(screen.getByLabelText("Document id"), {
      target: { value: "doc-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("Error: neo4j unreachable")).toBeTruthy();
  });
});

describe("GraphExplorerPage — Document visibility", () => {
  function oneDoc(overrides: Record<string, unknown> = {}) {
    documentsResult = {
      success: true,
      documents: [
        {
          id: "doc-1",
          title: "Board notes",
          source: null,
          created_at: null,
          entity_count: 4,
          visibility: "private",
          team_id: null,
          ...overrides,
        },
      ],
      count: 1,
    };
  }

  it("shows a private badge by default", async () => {
    oneDoc();
    render(<GraphExplorerPage />);
    expect(await screen.findByText("🔒 Private")).toBeTruthy();
  });

  it("shows the shared badge", async () => {
    oneDoc({ visibility: "shared" });
    render(<GraphExplorerPage />);
    expect(await screen.findByText("🌐 Shared")).toBeTruthy();
  });

  it("shows the team badge with the resolved team name", async () => {
    oneDoc({ visibility: "team", team_id: 7 });
    myTeamsResult = [{ id: 7, name: "Engineering" }];
    render(<GraphExplorerPage />);
    expect(await screen.findByText("👥 Team: Engineering")).toBeTruthy();
  });

  it("requires a team to be chosen before saving team visibility", async () => {
    oneDoc();
    myTeamsResult = [{ id: 7, name: "Engineering" }];
    render(<GraphExplorerPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Visibility for Board notes"), {
      target: { value: "team" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Choose a team to share this document with.");
  });

  it("saves visibility and team_id together, then refreshes the document list", async () => {
    oneDoc();
    myTeamsResult = [{ id: 7, name: "Engineering" }];
    render(<GraphExplorerPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Visibility for Board notes"), {
      target: { value: "team" },
    });
    fireEvent.change(screen.getByLabelText("Team to share with"), {
      target: { value: "7" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(lastVisibilityPath).toBe("/v1/graph-rag/graph/document/doc-1"));
    expect(lastVisibilityOpts?.body).toEqual({ visibility: "team", team_id: 7 });
    // Editing closes and the document list is reloaded (#502's lifted-reload
    // convention -- same as build/delete above).
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringContaining("/graph/documents"),
        expect.anything(),
      ),
    );
  });

  it("clears team_id when switching away from team visibility", async () => {
    oneDoc({ visibility: "team", team_id: 7 });
    myTeamsResult = [{ id: 7, name: "Engineering" }];
    render(<GraphExplorerPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Visibility for Board notes"), {
      target: { value: "private" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(lastVisibilityOpts?.body).toEqual({ visibility: "private", team_id: null }),
    );
  });

  it("shows a friendly error when the save fails", async () => {
    oneDoc();
    visibilityBehavior = async () => {
      throw new Error("neo4j unreachable");
    };
    render(<GraphExplorerPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Error: neo4j unreachable")).toBeTruthy();
  });
});

describe("GraphExplorerPage — Correlations", () => {
  it("runs correlation and reports per-correlator edge counts", async () => {
    render(<GraphExplorerPage />);

    fireEvent.click(screen.getByRole("button", { name: "Run correlation" }));

    expect(await screen.findByText(/Correlation run complete/)).toBeTruthy();
    expect(screen.getByText(/co_occurrence:/)).toBeTruthy();
    expect(screen.getByText(/embedding_neighbour:/)).toBeTruthy();
    // All correlators selected by default → send {} (backend runs its full set).
    await waitFor(() => expect(lastCorrelateOpts?.body?.correlators).toBeUndefined());
  });

  it("sends only the selected correlators when narrowed (#1216)", async () => {
    render(<GraphExplorerPage />);

    fireEvent.click(screen.getByText("Correlators to run"));
    // Deselect everything except co_occurrence.
    for (const name of [
      "embedding_neighbour",
      "entity_resolution",
      "entity_signal",
      "taxonomy",
      "temporal",
    ]) {
      fireEvent.click(screen.getByRole("checkbox", { name }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Run correlation" }));

    await waitFor(() =>
      expect(lastCorrelateOpts?.body?.correlators).toEqual(["co_occurrence"]),
    );
  });

  it("sends the chosen entity-context window and neighbors toggle (#1216)", async () => {
    render(<GraphExplorerPage />);
    fireEvent.click(screen.getByRole("button", { name: "Entity lookup" }));

    fireEvent.change(screen.getByLabelText("Context window"), {
      target: { value: "8" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Neighbors" }));
    fireEvent.change(screen.getByLabelText("Entity name to look up"), {
      target: { value: "Elon Musk" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Look up" }));

    await waitFor(() => {
      expect(lastEntityOpts?.body?.context_window).toBe(8);
      expect(lastEntityOpts?.body?.include_neighbors).toBe(false);
    });
  });

  it("reports skipped correlators when some are unavailable", async () => {
    correlateBehavior = async () => ({
      success: true,
      results: [{ correlator: "co_occurrence", edges: 3 }],
      skipped: ["temporal"],
    });
    render(<GraphExplorerPage />);

    fireEvent.click(screen.getByRole("button", { name: "Run correlation" }));

    expect(
      await screen.findByText(/Skipped \(unavailable\): temporal/),
    ).toBeTruthy();
  });

  it("looks up an entity's correlations across all four categories", async () => {
    render(<GraphExplorerPage />);

    fireEvent.change(
      screen.getByLabelText("Entity name to find correlations"),
      { target: { value: "Elon Musk" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Find correlations" }));

    expect(await screen.findByText(/Correlations for "Elon Musk"/)).toBeTruthy();
    expect(screen.getByText("SpaceX")).toBeTruthy(); // co-occurring
    expect(screen.getByText("Musk")).toBeTruthy(); // similar
    expect(screen.getByText("elon musk")).toBeTruthy(); // same-as variant
    // cross-modal signal line
    expect(
      screen.getByText(/crypto_price:BTC-USD ↔ crypto_price:ETH-USD/),
    ).toBeTruthy();
    await waitFor(() =>
      expect(lastCorrelationsPath).toContain("entity=Elon%20Musk"),
    );
  });

  it("sends max_hops + include_centrality and renders indirect links and centrality (#1214)", async () => {
    correlationsBehavior = async () => ({
      success: true,
      entity: "Elon Musk",
      found: true,
      co_occurring: [{ text: "SpaceX", label: "ORG", count: 4, centrality_score: 0.5 }],
      similar: [],
      same_as: [],
      correlated_signals: [],
      indirect: [{ text: "Tesla", label: "ORG", hops: 2, via: ["CO_OCCURS", "SIMILAR_TO"] }],
      entity_centrality_score: 0.73,
    });
    render(<GraphExplorerPage />);

    fireEvent.change(screen.getByLabelText("Correlation traversal depth (max hops)"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByLabelText("Show centrality scores"));
    fireEvent.change(screen.getByLabelText("Entity name to find correlations"), {
      target: { value: "Elon Musk" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find correlations" }));

    expect(await screen.findByText("Indirect (multi-hop reach)")).toBeTruthy();
    expect(screen.getByText("Tesla")).toBeTruthy();
    expect(screen.getByText(/2 hops via CO_OCCURS→SIMILAR_TO/)).toBeTruthy();
    // queried entity's own centrality in the header, and a per-item score
    expect(screen.getByText(/centrality 0.73/)).toBeTruthy();
    expect(screen.getByText(/c 0.50/)).toBeTruthy();
    await waitFor(() => {
      expect(lastCorrelationsPath).toContain("max_hops=2");
      expect(lastCorrelationsPath).toContain("include_centrality=true");
    });
  });

  it("requires an entity name before looking up correlations", () => {
    render(<GraphExplorerPage />);

    fireEvent.click(screen.getByRole("button", { name: "Find correlations" }));

    expect(screen.getByText("Entity name is required.")).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/graph/correlations"),
      expect.anything(),
    );
  });

  it("shows an empty-state when the entity isn't in the graph", async () => {
    correlationsBehavior = async () => ({
      success: true,
      entity: "Nobody",
      found: false,
      co_occurring: [],
      similar: [],
      same_as: [],
      correlated_signals: [],
    });
    render(<GraphExplorerPage />);

    fireEvent.change(
      screen.getByLabelText("Entity name to find correlations"),
      { target: { value: "Nobody" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Find correlations" }));

    expect(await screen.findByText(/isn't in your graph yet/)).toBeTruthy();
  });

  it("shows a friendly error when the correlations lookup fails", async () => {
    correlationsBehavior = async () => {
      throw new Error("neo4j unreachable");
    };
    render(<GraphExplorerPage />);

    fireEvent.change(
      screen.getByLabelText("Entity name to find correlations"),
      { target: { value: "Elon Musk" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Find correlations" }));

    expect(await screen.findByText("Error: neo4j unreachable")).toBeTruthy();
  });
});
