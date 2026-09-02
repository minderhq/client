import {
  cleanup,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
} from "@testing-library/react";
import { isValidElement, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import {
  AutoRouterStatsCard,
  CreatePipelineForm,
  PipelineCard,
  QueryResultCard,
  RagPipelinesPage,
  RetrievalMethodsReference,
  type KnowledgeBase,
  type QueryResponse,
  type RagPipeline,
} from "./RagPipelinesPage";

// PipelineCard now renders a react-router <Link> ("Ask this pipeline", #1229),
// so every bare render needs a Router in context. Wrap bare renders here — but
// NOT ones that already supply their own <MemoryRouter> (react-router throws on
// a Router nested inside a Router).
function render(ui: ReactNode, options?: Parameters<typeof rtlRender>[1]) {
  const alreadyRouted = isValidElement(ui) && ui.type === MemoryRouter;
  return rtlRender(alreadyRouted ? ui : <MemoryRouter>{ui}</MemoryRouter>, options);
}

const apiFetch = vi.fn();

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => apiFetch(...args),
  };
});
vi.mock("../lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));
vi.mock("../components/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: vi.fn(), dialog: null }),
}));

afterEach(() => {
  apiFetch.mockReset();
  cleanup();
});

// AutoRouterStatsCard is a pure presentational component (GET /v1/rag/decision-stats
// analytics, #707) — test its state branches directly by prop, no page mount needed.
describe("AutoRouterStatsCard", () => {
  it("renders nothing when stats are absent (deploy-skew graceful null)", () => {
    const { container } = render(<AutoRouterStatsCard stats={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the auto engine is unavailable", () => {
    const { container } = render(
      <AutoRouterStatsCard
        stats={{
          available: false,
          total_decisions: 0,
          strategy_distribution: {},
          complexity_distribution: {},
          avg_confidence: null,
        }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the empty note when available but no auto queries ran yet", () => {
    render(
      <AutoRouterStatsCard
        stats={{
          available: true,
          total_decisions: 0,
          strategy_distribution: {},
          complexity_distribution: {},
          avg_confidence: null,
        }}
      />,
    );
    expect(screen.getByText(/No/i)).toBeTruthy();
    expect(screen.getByText(/0 decisions recorded/i)).toBeTruthy();
  });

  it("renders the distributions and avg confidence when populated", () => {
    render(
      <AutoRouterStatsCard
        stats={{
          available: true,
          total_decisions: 3,
          strategy_distribution: { hybrid: 2, standard: 1 },
          complexity_distribution: { moderate: 2, simple: 1 },
          avg_confidence: 0.8,
        }}
      />,
    );
    expect(screen.getByText(/3 decisions recorded/i)).toBeTruthy();
    expect(screen.getByText("hybrid: 2")).toBeTruthy();
    expect(screen.getByText("standard: 1")).toBeTruthy();
    expect(screen.getByText("moderate: 2")).toBeTruthy();
    // avg_confidence 0.8 → "80%"
    expect(screen.getByText("80%")).toBeTruthy();
  });
});

describe("RetrievalMethodsReference", () => {
  it("lists every retrieval method and add-on", () => {
    render(<RetrievalMethodsReference />);
    expect(screen.getByText("standard")).toBeTruthy();
    expect(screen.getByText("raptor")).toBeTruthy();
    expect(screen.getByText("Rerank")).toBeTruthy();
    expect(screen.getByText("Continue conversation")).toBeTruthy();
  });
});

function queryResponse(overrides: Partial<QueryResponse> = {}): QueryResponse {
  return {
    answer: "The refund policy allows 30 days.",
    sources: [],
    confidence: 0.9,
    model_used: "llama3",
    method: "standard",
    ...overrides,
  };
}

describe("QueryResultCard", () => {
  it("shows confidence, model, and method", () => {
    render(<QueryResultCard response={queryResponse()} />);
    expect(screen.getByText("90% confidence")).toBeTruthy();
    expect(screen.getByText(/Model: llama3/)).toBeTruthy();
    expect(screen.getByText(/Method: standard/)).toBeTruthy();
  });

  it("copies the answer text to the clipboard and shows a checkmark", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<QueryResultCard response={queryResponse()} />);

    fireEvent.click(screen.getByLabelText("Copy answer"));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("The refund policy allows 30 days."),
    );
    await screen.findByLabelText("Answer copied");
    vi.unstubAllGlobals();
  });

  it("shows a token count when present", () => {
    render(<QueryResultCard response={queryResponse({ tokens_used: 42 })} />);
    expect(screen.getByText(/\(42 tokens\)/)).toBeTruthy();
  });

  it("shows a degraded warning when method_details.degraded is non-empty", () => {
    render(
      <QueryResultCard
        response={queryResponse({
          method_details: { retrieval: "dense", degraded: ["rerank"] },
        })}
      />,
    );
    expect(screen.getByText(/Degraded: rerank/)).toBeTruthy();
  });

  it("shows the metadata filter source when present", () => {
    render(
      <QueryResultCard
        response={queryResponse({
          method_details: { retrieval: "dense", metadata_filter: { source: "handbook.pdf" } },
        })}
      />,
    );
    expect(screen.getByText(/Filtered to: handbook.pdf/)).toBeTruthy();
  });

  it("shows sources unless compact", () => {
    const response = queryResponse({
      sources: [{ text: "Refunds are allowed within 30 days of purchase.", source: "handbook.pdf", score: 0.87 }],
    });
    const { rerender } = render(<QueryResultCard response={response} />);
    expect(screen.getByText("Sources")).toBeTruthy();

    rerender(<QueryResultCard response={response} compact />);
    expect(screen.queryByText("Sources")).toBeNull();
  });

  it("truncates a long source snippet with an ellipsis", () => {
    const longText = "x".repeat(250);
    render(
      <QueryResultCard
        response={queryResponse({ sources: [{ text: longText, source: "a.pdf", score: 0.5 }] })}
      />,
    );
    expect(screen.getByText((t) => t.endsWith("…"))).toBeTruthy();
  });
});

const kb: KnowledgeBase = {
  id: "kb-1",
  name: "Support docs",
  document_count: 3,
  vector_count: 42,
};

describe("CreatePipelineForm", () => {
  it("prompts to create a knowledge base first when none exist", () => {
    render(<CreatePipelineForm token="tok" kbs={[]} onCreated={vi.fn()} />);
    expect(screen.getByText(/Create a knowledge base first/)).toBeTruthy();
  });

  it("requires a name", async () => {
    render(<CreatePipelineForm token="tok" kbs={[kb]} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByText("Name is required.");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("requires at least one knowledge base", async () => {
    render(<CreatePipelineForm token="tok" kbs={[kb]} onCreated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "My pipeline" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByText("Pick at least one knowledge base.");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("creates a pipeline and resets the form", async () => {
    apiFetch.mockResolvedValue({
      pipeline_id: "p-1",
      name: "My pipeline",
      knowledge_base_ids: ["kb-1"],
      created_at: "2026-01-01T00:00:00Z",
    });
    const onCreated = vi.fn();
    render(<CreatePipelineForm token="tok" kbs={[kb]} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "My pipeline" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith({
        id: "p-1",
        name: "My pipeline",
        knowledge_base_ids: ["kb-1"],
        created_at: "2026-01-01T00:00:00Z",
      }),
    );
    expect(apiFetch).toHaveBeenCalledWith("/v1/rag/pipeline", {
      method: "POST",
      body: { name: "My pipeline", knowledge_base_ids: ["kb-1"] },
      token: "tok",
    });
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
  });

  it("shows a friendly error on failure and leaves creating re-enabled", async () => {
    apiFetch.mockRejectedValue(new Error("rag-pipeline unreachable"));
    render(<CreatePipelineForm token="tok" kbs={[kb]} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "My pipeline" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await screen.findByText("rag-pipeline unreachable");
    expect(
      (screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("shows a login hint and disables submit when logged out", () => {
    render(<CreatePipelineForm token="" kbs={[kb]} onCreated={vi.fn()} />);
    expect(screen.getByText("Log in to create a pipeline.")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

// Retained so the page's (now dead) capabilities/models mock branches below
// still resolve if the page ever re-adds those fetches; the query UI itself
// moved to Ask (#1229), so the page no longer requests capabilities.
const caps = {
  methods: {
    standard: true,
    conversational: true,
    hyde: true,
    self_rag: true,
    auto: true,
    corrective: true,
    raptor: true,
  },
  enhancers: {
    rerank: { available: true, backend: "cross-encoder" },
    compress: { available: true },
  },
  retrievers: {
    dense: { available: true },
    hybrid: { available: true },
    parent_child: { available: true },
    metadata_filter: { available: true },
  },
};


function pipeline(overrides: Partial<RagPipeline> = {}): RagPipeline {
  return {
    id: "p-1",
    name: "Support pipeline",
    knowledge_base_ids: ["kb-1"],
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("PipelineCard", () => {
  it("shows a login hint and disables rename/delete when logged out", () => {
    render(
      <PipelineCard
        pipeline={pipeline()}
        token=""        onDeleted={vi.fn()}
        onUpdated={vi.fn()}
        confirm={vi.fn()}
      />,
    );
    expect(screen.getByText("Log in to edit or delete this pipeline.")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("rejects an empty name on rename", async () => {
    render(
      <PipelineCard
        pipeline={pipeline({ knowledge_base_ids: [] })}
        token="tok"        onDeleted={vi.fn()}
        onUpdated={vi.fn()}
        confirm={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Pipeline name"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Name can't be empty.");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("saves a rename and exits edit mode", async () => {
    apiFetch.mockResolvedValue(pipeline({ name: "Renamed" }));
    const onUpdated = vi.fn();
    render(
      <PipelineCard
        pipeline={pipeline()}
        token="tok"        onDeleted={vi.fn()}
        onUpdated={onUpdated}
        confirm={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Pipeline name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(pipeline({ name: "Renamed" })));
    expect(apiFetch).toHaveBeenCalledWith("/v1/rag/pipeline/p-1", {
      method: "PATCH",
      body: { name: "Renamed", visibility: "private", team_id: null },
      token: "tok",
    });
    expect(screen.queryByLabelText("Pipeline name")).toBeNull();
  });

  it("cancels a rename without saving", () => {
    render(
      <PipelineCard
        pipeline={pipeline({ knowledge_base_ids: [] })}
        token="tok"        onDeleted={vi.fn()}
        onUpdated={vi.fn()}
        confirm={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Pipeline name"), { target: { value: "Discard me" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByText("Support pipeline")).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("does not delete when the confirmation is declined", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const onDeleted = vi.fn();
    render(
      <PipelineCard
        pipeline={pipeline({ knowledge_base_ids: [] })}
        token="tok"        onDeleted={onDeleted}
        onUpdated={vi.fn()}
        confirm={confirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());

    expect(apiFetch).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("deletes once confirmed", async () => {
    apiFetch.mockResolvedValue({});
    const confirm = vi.fn().mockResolvedValue(true);
    const onDeleted = vi.fn();
    render(
      <PipelineCard
        pipeline={pipeline()}
        token="tok"        onDeleted={onDeleted}
        onUpdated={vi.fn()}
        confirm={confirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("p-1"));
    expect(apiFetch).toHaveBeenCalledWith("/v1/rag/pipeline/p-1", {
      method: "DELETE",
      token: "tok",
    });
  });

  it("treats a 404 on delete as already-gone, not an error", async () => {
    apiFetch.mockRejectedValue(new ApiError("not found", 404));
    const confirm = vi.fn().mockResolvedValue(true);
    const onDeleted = vi.fn();
    render(
      <PipelineCard
        pipeline={pipeline()}
        token="tok"        onDeleted={onDeleted}
        onUpdated={vi.fn()}
        confirm={confirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("p-1"));
  });

  it("shows a friendly error on a non-404 delete failure", async () => {
    apiFetch.mockRejectedValue(new Error("rag-pipeline unreachable"));
    const confirm = vi.fn().mockResolvedValue(true);
    render(
      <PipelineCard
        pipeline={pipeline()}
        token="tok"        onDeleted={vi.fn()}
        onUpdated={vi.fn()}
        confirm={confirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await screen.findByText("rag-pipeline unreachable");
  });

  it("does not crash when the copy-id button is clicked", () => {
    render(
      <PipelineCard
        pipeline={pipeline()}
        token="tok"        onDeleted={vi.fn()}
        onUpdated={vi.fn()}
        confirm={vi.fn()}
      />,
    );
    expect(() => fireEvent.click(screen.getByText("copy"))).not.toThrow();
  });

  it("shows knowledge base names, falling back to a short id (#1231)", () => {
    render(
      <PipelineCard
        pipeline={pipeline({ knowledge_base_ids: ["kb-1", "0123456789abcdef"] })}
        token="tok"        kbNames={{ "kb-1": "Support docs" }}
        onDeleted={vi.fn()}
        onUpdated={vi.fn()}
        confirm={vi.fn()}
      />,
    );
    // Known id -> its name; unknown id -> shortened, never the raw 36-char uuid.
    expect(screen.getByText("Support docs")).toBeTruthy();
    expect(screen.getByText("01234567…")).toBeTruthy();
    expect(screen.queryByText("0123456789abcdef")).toBeNull();
  });

  // ── #1046 (Phase 4 slice 4): visibility/team sharing ────────────────────

  it("shows a private badge by default", () => {
    render(
      <PipelineCard
        pipeline={pipeline()}
        token="tok"        onDeleted={vi.fn()}
        onUpdated={vi.fn()}
        confirm={vi.fn()}
      />,
    );
    expect(screen.getByText("🔒 Private (only me)")).toBeTruthy();
  });

  it("shows the shared badge", () => {
    render(
      <PipelineCard
        pipeline={pipeline({ visibility: "shared" })}
        token="tok"        onDeleted={vi.fn()}
        onUpdated={vi.fn()}
        confirm={vi.fn()}
      />,
    );
    expect(screen.getByText("🌐 Shared (everyone)")).toBeTruthy();
  });

  it("shows the team badge with the resolved team name", () => {
    render(
      <PipelineCard
        pipeline={pipeline({ visibility: "team", team_id: 7 })}
        token="tok"
        myTeams={[{ id: 7, name: "Engineering" }]}
        onDeleted={vi.fn()}
        onUpdated={vi.fn()}
        confirm={vi.fn()}
      />,
    );
    expect(screen.getByText("👥 Shared with team: Engineering")).toBeTruthy();
  });

  it("requires a team to be chosen before saving team visibility", async () => {
    render(
      <PipelineCard
        pipeline={pipeline()}
        token="tok"
        myTeams={[{ id: 7, name: "Engineering" }]}
        onDeleted={vi.fn()}
        onUpdated={vi.fn()}
        confirm={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Visibility"), { target: { value: "team" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Choose a team to share this pipeline with.");
  });

  it("saves visibility and team_id together", async () => {
    apiFetch.mockResolvedValue(pipeline({ visibility: "team", team_id: 7 }));
    const onUpdated = vi.fn();
    render(
      <PipelineCard
        pipeline={pipeline()}
        token="tok"
        myTeams={[{ id: 7, name: "Engineering" }]}
        onDeleted={vi.fn()}
        onUpdated={onUpdated}
        confirm={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Visibility"), { target: { value: "team" } });
    fireEvent.change(screen.getByLabelText("Team to share with"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/v1/rag/pipeline/p-1",
        expect.objectContaining({
          method: "PATCH",
          body: expect.objectContaining({ visibility: "team", team_id: 7 }),
        }),
      ),
    );
    expect(onUpdated).toHaveBeenCalledWith(pipeline({ visibility: "team", team_id: 7 }));
  });

  it("clears team_id when switching away from team visibility", async () => {
    apiFetch.mockResolvedValue(pipeline({ visibility: "private" }));
    render(
      <PipelineCard
        pipeline={pipeline({ visibility: "team", team_id: 7 })}
        token="tok"
        myTeams={[{ id: 7, name: "Engineering" }]}
        onDeleted={vi.fn()}
        onUpdated={vi.fn()}
        confirm={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Visibility"), { target: { value: "private" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/v1/rag/pipeline/p-1",
        expect.objectContaining({
          body: expect.objectContaining({ visibility: "private", team_id: null }),
        }),
      ),
    );
  });
});

describe("RagPipelinesPage", () => {
  it("loads knowledge bases and pipelines on mount", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/v1/rag/knowledge-bases")) return Promise.resolve({ items: [kb] });
      if (path === "/v1/rag/capabilities") return Promise.resolve(caps);
      if (path.startsWith("/v1/rag/pipeline?")) return Promise.resolve({ items: [pipeline()] });
      if (path === "/v1/rag/decision-stats") return Promise.resolve(null);
      if (path === "/v1/teams?limit=500") return Promise.resolve({ teams: [] });
      if (path.startsWith("/v1/models")) return Promise.resolve({ items: [] });
      throw new Error(`unexpected path ${path}`);
    });
    render(
      <MemoryRouter>
        <RagPipelinesPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Support pipeline")).toBeTruthy();
  });

  it("degrades gracefully when decision-stats 404s (older backend)", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/v1/rag/knowledge-bases")) return Promise.resolve({ items: [] });
      if (path === "/v1/rag/capabilities") return Promise.resolve(caps);
      if (path.startsWith("/v1/rag/pipeline?")) return Promise.resolve({ items: [] });
      if (path === "/v1/rag/decision-stats") return Promise.reject(new ApiError("not found", 404));
      if (path === "/v1/teams?limit=500") return Promise.resolve({ teams: [] });
      if (path.startsWith("/v1/models")) return Promise.resolve({ items: [] });
      throw new Error(`unexpected path ${path}`);
    });
    render(
      <MemoryRouter>
        <RagPipelinesPage />
      </MemoryRouter>,
    );

    await screen.findByText(/No pipelines created yet/);
    // The whole page loaded fine despite decision-stats failing.
    expect(screen.queryByText(/Auto-router analytics/)).toBeNull();
  });

  it("shows a friendly error status when the initial load fails", async () => {
    apiFetch.mockRejectedValue(new Error("rag-pipeline unreachable"));
    render(
      <MemoryRouter>
        <RagPipelinesPage />
      </MemoryRouter>,
    );

    await screen.findByText("rag-pipeline unreachable");
  });

  it("filters pipelines by name", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/v1/rag/knowledge-bases")) return Promise.resolve({ items: [] });
      if (path === "/v1/rag/capabilities") return Promise.resolve(caps);
      if (path.startsWith("/v1/rag/pipeline?")) {
        return Promise.resolve({
          items: [pipeline({ id: "p-1", name: "Support" }), pipeline({ id: "p-2", name: "Sales" })],
        });
      }
      if (path === "/v1/rag/decision-stats") return Promise.resolve(null);
      if (path === "/v1/teams?limit=500") return Promise.resolve({ teams: [] });
      if (path.startsWith("/v1/models")) return Promise.resolve({ items: [] });
      throw new Error(`unexpected path ${path}`);
    });
    render(
      <MemoryRouter>
        <RagPipelinesPage />
      </MemoryRouter>,
    );
    await screen.findByText("Support");

    fireEvent.change(screen.getByLabelText("Filter pipelines"), { target: { value: "sal" } });

    expect(screen.getByText("Sales")).toBeTruthy();
    expect(screen.queryByText("Support")).toBeNull();
    expect(screen.getByText("1 of 2")).toBeTruthy();
  });

  it("shows a no-match empty state when the filter matches nothing", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/v1/rag/knowledge-bases")) return Promise.resolve({ items: [] });
      if (path === "/v1/rag/capabilities") return Promise.resolve(caps);
      if (path.startsWith("/v1/rag/pipeline?")) {
        return Promise.resolve({
          items: [pipeline({ id: "p-1", name: "Support" }), pipeline({ id: "p-2", name: "Sales" })],
        });
      }
      if (path === "/v1/rag/decision-stats") return Promise.resolve(null);
      if (path === "/v1/teams?limit=500") return Promise.resolve({ teams: [] });
      if (path.startsWith("/v1/models")) return Promise.resolve({ items: [] });
      throw new Error(`unexpected path ${path}`);
    });
    render(
      <MemoryRouter>
        <RagPipelinesPage />
      </MemoryRouter>,
    );
    await screen.findByText("Support");

    fireEvent.change(screen.getByLabelText("Filter pipelines"), { target: { value: "nope" } });

    await screen.findByText('No pipelines match "nope".');
  });

  it("links each pipeline card to Ask with the pipeline preselected (#1229)", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/v1/rag/knowledge-bases")) return Promise.resolve({ items: [] });
      if (path.startsWith("/v1/rag/pipeline?")) return Promise.resolve({ items: [pipeline()] });
      if (path === "/v1/rag/decision-stats") return Promise.resolve(null);
      if (path === "/v1/teams?limit=500") return Promise.resolve({ teams: [] });
      throw new Error(`unexpected path ${path}`);
    });
    render(
      <MemoryRouter>
        <RagPipelinesPage />
      </MemoryRouter>,
    );

    await screen.findByText("Support pipeline");
    const ask = screen.getByRole("link", { name: /Ask this pipeline/ });
    expect(ask.getAttribute("href")).toBe("/ask?pipeline=p-1");
  });

  it("fetches teams and passes them down for the team picker", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/v1/rag/knowledge-bases")) return Promise.resolve({ items: [] });
      if (path === "/v1/rag/capabilities") return Promise.resolve(caps);
      if (path.startsWith("/v1/rag/pipeline?")) {
        return Promise.resolve({ items: [pipeline({ visibility: "team", team_id: 7 })] });
      }
      if (path === "/v1/rag/decision-stats") return Promise.resolve(null);
      if (path === "/v1/teams?limit=500") {
        return Promise.resolve({ teams: [{ id: 7, name: "Engineering" }] });
      }
      if (path.startsWith("/v1/models")) return Promise.resolve({ items: [] });
      throw new Error(`unexpected path ${path}`);
    });
    render(
      <MemoryRouter>
        <RagPipelinesPage />
      </MemoryRouter>,
    );

    await screen.findByText("👥 Shared with team: Engineering");
  });
});
