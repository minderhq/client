import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import { AskPage } from "./AskPage";
import type { Capabilities, QueryResponse, RagPipeline } from "./RagPipelinesPage";

// jsdom doesn't implement Element.scrollTo (used to auto-scroll the
// transcript as turns are added) -- confirmed live: "scrollTo is not a
// function" the moment a turn is appended.
Element.prototype.scrollTo = vi.fn();

const apiFetch = vi.fn();

let searchParams = new URLSearchParams();
vi.mock("react-router-dom", () => ({
  useSearchParams: () => [searchParams, () => {}],
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

// GoldenPathStepper self-fetches its own journey counts; stub it so it doesn't
// add noise to the apiFetch mock queue these tests assert against (it has its
// own dedicated test coverage).
vi.mock("../components/GoldenPathStepper", () => ({
  GoldenPathStepper: () => null,
}));

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => apiFetch(...args),
  };
});

let mockAuth = { token: "", isAuthenticated: false };
vi.mock("../lib/auth", () => ({
  useAuth: () => mockAuth,
}));

const caps: Capabilities = {
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
    rerank: { available: true },
    compress: { available: true },
  },
  retrievers: {
    dense: { available: true },
    hybrid: { available: true },
    parent_child: { available: true },
    metadata_filter: { available: true },
  },
};

function noConversationCaps(): Capabilities {
  return { ...caps, methods: { ...caps.methods, conversational: false } };
}

function pipeline(overrides: Partial<RagPipeline> = {}): RagPipeline {
  return {
    id: "p-1",
    name: "Support pipeline",
    knowledge_base_ids: ["kb-1"],
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function queryResponse(overrides: Partial<QueryResponse> = {}): QueryResponse {
  return {
    answer: "The refund window is 30 days.",
    sources: [{ text: "Refunds within 30 days...", source: "handbook.pdf", score: 0.9 }],
    confidence: 0.87,
    model_used: "llama3",
    method: "standard",
    ...overrides,
  };
}

/** Routes apiFetch for the page's load()/models/docs effects, so each test
 * only needs to say what's different from a single-pipeline, full-capability
 * default. */
function routeApiFetch(opts: {
  pipelines?: RagPipeline[];
  capabilities?: Capabilities;
  queryResult?: QueryResponse | (() => Promise<QueryResponse>);
  queryError?: unknown;
} = {}) {
  const {
    pipelines = [pipeline()],
    capabilities = caps,
    queryResult = queryResponse(),
    queryError,
  } = opts;
  apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === "/v1/rag/capabilities") return Promise.resolve(capabilities);
    if (path.startsWith("/v1/rag/pipeline?"))
      return Promise.resolve({ items: pipelines, total: pipelines.length });
    if (path.startsWith("/v1/models")) return Promise.resolve({ items: [], total: 0 });
    if (path.includes("/documents")) return Promise.resolve({ items: [], total: 0 });
    if (path.match(/\/v1\/rag\/pipeline\/.+\/query$/) && init?.method === "POST") {
      if (queryError) return Promise.reject(queryError);
      return typeof queryResult === "function" ? queryResult() : Promise.resolve(queryResult);
    }
    return Promise.reject(new Error(`unexpected ${init?.method ?? "GET"} ${path}`));
  });
}

describe("AskPage", () => {
  afterEach(() => {
    apiFetch.mockReset();
    mockAuth = { token: "", isAuthenticated: false };
    searchParams = new URLSearchParams();
    cleanup();
  });

  it("shows an empty state pointing at Pipelines when there are none yet", async () => {
    routeApiFetch({ pipelines: [] });
    render(<AskPage />);

    await screen.findByText("You have no pipelines yet. Create a knowledge base and a", {
      exact: false,
    });
  });

  it("preselects the pipeline and shows the empty transcript with suggestions", async () => {
    routeApiFetch({});
    render(<AskPage />);

    await screen.findByText("Ask anything about your documents");
    expect(screen.getByText("1 knowledge base")).toBeTruthy();
    expect(
      screen.getByText("Summarize the key points across these documents."),
    ).toBeTruthy();
  });

  it("disables the composer and suggestions, and prompts to log in, when logged out", async () => {
    routeApiFetch({});
    render(<AskPage />);
    await screen.findByText("Ask anything about your documents");

    expect(screen.getByRole("link", { name: "Log in" })).toBeTruthy();
    expect(
      screen.getByText(/to ask questions\. Browsing your pipelines is open to everyone\./),
    ).toBeTruthy();
    expect((screen.getByLabelText("Your question") as HTMLTextAreaElement).disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Summarize the key points across these documents." }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("preselects the pipeline named by ?pipeline= (deep link)", async () => {
    searchParams = new URLSearchParams({ pipeline: "p-2" });
    routeApiFetch({ pipelines: [pipeline(), pipeline({ id: "p-2", name: "Legal pipeline" })] });
    render(<AskPage />);

    await screen.findByText("Legal pipeline");
  });

  it("shows a continuing-conversation banner when seeded with ?conversation_id=", async () => {
    searchParams = new URLSearchParams({ conversation_id: "conv-1" });
    routeApiFetch({});
    render(<AskPage />);

    await screen.findByText(/Continuing a conversation from your history/);
  });

  it("asks a question, shows it pending, then renders the answer", async () => {
    mockAuth = { token: "tok", isAuthenticated: true };
    routeApiFetch({});
    render(<AskPage />);
    await screen.findByText("Ask anything about your documents");

    fireEvent.change(screen.getByLabelText("Your question"), {
      target: { value: "What is the refund policy?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(screen.getByText("What is the refund policy?")).toBeTruthy();
    await screen.findByText("The refund window is 30 days.");
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/rag/pipeline/p-1/query",
      expect.objectContaining({
        method: "POST",
        token: "tok",
        body: expect.objectContaining({
          question: "What is the refund policy?",
          top_k: 5,
          method: "standard",
          rerank: false,
          compress: false,
          hybrid: false,
          parent_context: false,
        }),
      }),
    );
  });

  it("sends on Enter but inserts a newline on Shift+Enter", async () => {
    mockAuth = { token: "tok", isAuthenticated: true };
    routeApiFetch({});
    render(<AskPage />);
    await screen.findByText("Ask anything about your documents");

    const textarea = screen.getByLabelText("Your question");
    fireEvent.change(textarea, { target: { value: "Shift enter test" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(apiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/query"),
      expect.anything(),
    );

    fireEvent.keyDown(textarea, { key: "Enter" });
    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/v1/rag/pipeline/p-1/query",
        expect.anything(),
      ),
    );
  });

  it("clicking a suggestion asks it directly", async () => {
    mockAuth = { token: "tok", isAuthenticated: true };
    routeApiFetch({});
    render(<AskPage />);
    await screen.findByText("Ask anything about your documents");

    fireEvent.click(
      screen.getByRole("button", { name: "Summarize the key points across these documents." }),
    );

    await screen.findByText("The refund window is 30 days.");
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/rag/pipeline/p-1/query",
      expect.objectContaining({
        body: expect.objectContaining({
          question: "Summarize the key points across these documents.",
        }),
      }),
    );
  });

  it("shows a friendly error inline and offers a retry on a normal failure", async () => {
    mockAuth = { token: "tok", isAuthenticated: true };
    routeApiFetch({ queryError: new Error("pipeline timed out") });
    render(<AskPage />);
    await screen.findByText("Ask anything about your documents");

    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await screen.findByText("pipeline timed out");
  });

  it("on a 404 (pipeline deleted server-side), shows a specific message and reloads pipelines", async () => {
    mockAuth = { token: "tok", isAuthenticated: true };
    routeApiFetch({ queryError: new ApiError("gone", 404) });
    render(<AskPage />);
    await screen.findByText("Ask anything about your documents");
    apiFetch.mockClear();

    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await screen.findByText(
      "This pipeline no longer exists on the server. Reloading your pipelines…",
    );
    // The 404 handler calls load() again -- the still-mocked query error
    // doesn't matter here, only that capabilities/pipelines got re-fetched.
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/v1/rag/capabilities"));
  });

  it("New chat clears the transcript and starts a fresh conversation", async () => {
    mockAuth = { token: "tok", isAuthenticated: true };
    routeApiFetch({});
    render(<AskPage />);
    await screen.findByText("Ask anything about your documents");

    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText("The refund window is 30 days.");

    fireEvent.click(screen.getByRole("button", { name: "New chat" }));

    expect(screen.queryByText("The refund window is 30 days.")).toBeNull();
    await screen.findByText("Ask anything about your documents");
  });

  it("switching pipeline clears the transcript for the new context", async () => {
    mockAuth = { token: "tok", isAuthenticated: true };
    routeApiFetch({ pipelines: [pipeline(), pipeline({ id: "p-2", name: "Legal pipeline" })] });
    render(<AskPage />);
    await screen.findByText("Ask anything about your documents");

    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText("The refund window is 30 days.");

    fireEvent.change(screen.getByLabelText("Pipeline to query"), { target: { value: "p-2" } });

    expect(screen.queryByText("The refund window is 30 days.")).toBeNull();
  });

  it("notes that conversational memory is unavailable once a question has been asked without it", async () => {
    mockAuth = { token: "tok", isAuthenticated: true };
    routeApiFetch({ capabilities: noConversationCaps() });
    render(<AskPage />);
    await screen.findByText("Ask anything about your documents");

    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await screen.findByText(
      "Conversational memory is unavailable on this host — each question is answered independently.",
    );
  });
});
