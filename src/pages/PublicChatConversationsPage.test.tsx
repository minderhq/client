import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PublicChatConversationsPage } from "./PublicChatConversationsPage";

const apiFetch = vi.fn();
vi.mock("../lib/api", () => ({
  apiBaseUrl: "http://gateway.test",
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  friendlyErrorMessage: (e: unknown) =>
    e instanceof Error ? e.message : String(e),
}));

let mockAuth = {
  token: "",
  role: "",
  orgRole: "",
  isPlatformAdmin: false,
};
vi.mock("../lib/auth", () => ({
  useAuth: () => mockAuth,
}));

const ADMIN = {
  token: "tok",
  role: "member",
  orgRole: "admin",
  isPlatformAdmin: false,
};

const ENDPOINT = {
  id: 7,
  tenant_id: "t1",
  name: "Support Bot",
  slug: "support",
  pipeline_id: "pipe-1",
  rag_config: {},
  enabled: true,
  rate_limit_per_minute: 20,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function session(overrides: Record<string, unknown> = {}) {
  return {
    session_id: "sess-abcdef123456789",
    tenant_id: "t1",
    created_at: "2026-02-01T10:00:00Z",
    last_active_at: "2026-02-01T11:00:00Z",
    turn_count: 3,
    ...overrides,
  };
}

const NO_FEEDBACK = { endpoint_id: 7, up: 0, down: 0, total: 0, with_comments: 0 };

/** Route apiFetch by path so the endpoint-metadata GET, the sessions list, the
 * feedback summary, and the single-conversation GET each resolve independently
 * of call order. */
function installApi(opts: {
  endpoint?: unknown;
  endpointError?: Error;
  sessions?: unknown[];
  total?: number;
  sessionsError?: Error;
  detail?: unknown;
  detailError?: Error;
  summary?: unknown;
  summaryError?: Error;
} = {}) {
  const {
    endpoint = ENDPOINT,
    endpointError,
    sessions = [],
    total,
    sessionsError,
    detail,
    detailError,
    summary = NO_FEEDBACK,
    summaryError,
  } = opts;
  apiFetch.mockImplementation((path: string) => {
    // Feedback summary: /v1/public-chat/endpoints/{id}/feedback
    if (/\/feedback$/.test(path)) {
      return summaryError
        ? Promise.reject(summaryError)
        : Promise.resolve(summary);
    }
    // Single conversation: .../conversations/{session_id}
    if (/\/conversations\/[^/]+$/.test(path)) {
      return detailError
        ? Promise.reject(detailError)
        : Promise.resolve(detail);
    }
    // Conversations list: .../conversations?...
    if (path.includes("/conversations")) {
      return sessionsError
        ? Promise.reject(sessionsError)
        : Promise.resolve({
            items: sessions,
            total: total ?? sessions.length,
            limit: 20,
            offset: 0,
          });
    }
    // Endpoint metadata: /v1/public-chat/endpoints/{id}
    return endpointError
      ? Promise.reject(endpointError)
      : Promise.resolve(endpoint);
  });
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/rag/public-chat/:endpointId/conversations"
          element={<PublicChatConversationsPage />}
        />
        <Route
          path="/rag/public-chat/:endpointId/conversations/:sessionId"
          element={<PublicChatConversationsPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

const LIST_PATH = "/rag/public-chat/7/conversations";
const DETAIL_PATH = (id: string) =>
  `/rag/public-chat/7/conversations/${id}`;

describe("PublicChatConversationsPage", () => {
  afterEach(() => {
    cleanup();
    apiFetch.mockReset();
  });

  it("gates non-admins and never fetches", () => {
    mockAuth = { token: "tok", role: "member", orgRole: "member", isPlatformAdmin: false };
    renderAt(LIST_PATH);
    expect(
      screen.getByText("Admin role required to view public chat conversations."),
    ).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("prompts to log in when unauthenticated", () => {
    mockAuth = { token: "", role: "", orgRole: "", isPlatformAdmin: false };
    renderAt(LIST_PATH);
    expect(
      screen.getByText("Log in as an admin to view public chat conversations."),
    ).toBeTruthy();
  });

  it("lists conversations with turn count and the endpoint name in the header", async () => {
    mockAuth = ADMIN;
    installApi({
      sessions: [
        session({ session_id: "sess-one000000000", turn_count: 2 }),
        session({ session_id: "sess-two000000000", turn_count: 5 }),
      ],
      total: 2,
    });
    renderAt(LIST_PATH);

    // Endpoint name lands in the subtitle once its metadata resolves.
    expect(
      await screen.findByText(/"Support Bot" public chat endpoint/),
    ).toBeTruthy();
    // Short session id + turn count badges render for each row.
    expect(screen.getByText("sess-one0000…")).toBeTruthy();
    expect(screen.getByText("sess-two0000…")).toBeTruthy();
    expect(screen.getByText("2 turns")).toBeTruthy();
    expect(screen.getByText("5 turns")).toBeTruthy();
    expect(screen.getByText("2 conversations, most recently active first.")).toBeTruthy();
  });

  it("shows an empty state when the endpoint has no conversations", async () => {
    mockAuth = ADMIN;
    installApi({ sessions: [] });
    renderAt(LIST_PATH);
    expect(
      await screen.findByText(/No conversations yet/),
    ).toBeTruthy();
  });

  it("paginates with Load more when more remain", async () => {
    mockAuth = ADMIN;
    const first = Array.from({ length: 20 }, (_, i) =>
      session({ session_id: `sess-${i}00000000000`, turn_count: 1 }),
    );
    installApi({ sessions: first, total: 25 });
    renderAt(LIST_PATH);

    const loadMore = await screen.findByText("Load more");

    // Second page: offset=20 returns the remaining 5.
    apiFetch.mockImplementationOnce(() =>
      Promise.resolve({
        items: Array.from({ length: 5 }, (_, i) =>
          session({ session_id: `sess-2nd-${i}0000000`, turn_count: 1 }),
        ),
        total: 25,
        limit: 20,
        offset: 20,
      }),
    );
    fireEvent.click(loadMore);

    expect(await screen.findByText("sess-2nd-000…")).toBeTruthy();
    // 20 + 5 loaded === total, so Load more is gone.
    await waitFor(() =>
      expect(screen.queryByText("Load more")).toBeNull(),
    );
  });

  it("surfaces a list fetch error", async () => {
    mockAuth = ADMIN;
    installApi({ sessionsError: new Error("gateway unreachable") });
    renderAt(LIST_PATH);
    expect(await screen.findByText("gateway unreachable")).toBeTruthy();
  });

  it("shows a not-found state when the endpoint 404s (cross-tenant/other owner)", async () => {
    mockAuth = ADMIN;
    installApi({ endpointError: new Error("Public chat endpoint not found") });
    renderAt(LIST_PATH);
    expect(
      await screen.findByText("Public chat endpoint not found"),
    ).toBeTruthy();
  });

  it("drills into a conversation and renders its turns read-only", async () => {
    mockAuth = ADMIN;
    installApi({
      detail: {
        session: session({ session_id: "sess-detail0000000", turn_count: 2 }),
        turns: [
          { question: "What are your hours?", answer: "9 to 5, Mon-Fri.", timestamp: "2026-02-01T10:00:00Z", metadata: {} },
          { question: "Where are you?", answer: "Remote, worldwide.", timestamp: "2026-02-01T10:05:00Z", metadata: {} },
        ],
      },
    });
    renderAt(DETAIL_PATH("sess-detail0000000"));

    expect(await screen.findByText("What are your hours?")).toBeTruthy();
    expect(screen.getByText("9 to 5, Mon-Fri.")).toBeTruthy();
    expect(screen.getByText("Where are you?")).toBeTruthy();
    expect(screen.getByText("Remote, worldwide.")).toBeTruthy();
    // Read-only: no reply/compose affordance.
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("Back to conversations")).toBeTruthy();
  });

  it("shows an empty state when a conversation has no turns", async () => {
    mockAuth = ADMIN;
    installApi({
      detail: { session: session(), turns: [] },
    });
    renderAt(DETAIL_PATH("sess-empty00000000"));
    expect(
      await screen.findByText("This conversation has no recorded turns."),
    ).toBeTruthy();
  });

  it("shows a not-found state when the conversation 404s", async () => {
    mockAuth = ADMIN;
    installApi({ detailError: new Error("Conversation not found") });
    renderAt(DETAIL_PATH("sess-missing000000"));
    expect(
      await screen.findByText("Conversation not found"),
    ).toBeTruthy();
    expect(screen.getByText("Back to conversations")).toBeTruthy();
  });

  // ── #1583: per-turn feedback display ───────────────────────────────────────
  it("shows a rated turn's thumbs verdict and comment (#1583)", async () => {
    mockAuth = ADMIN;
    installApi({
      detail: {
        session: session({ session_id: "sess-fb0000000000", turn_count: 2 }),
        turns: [
          {
            question: "Do you offer refunds?",
            answer: "Yes, within 30 days.",
            timestamp: "2026-02-01T10:00:00Z",
            metadata: {},
            feedback: {
              rating: 1,
              comment: "Exactly what I needed, thanks!",
              feedback_at: "2026-02-01T10:01:00Z",
            },
          },
          {
            question: "Ship to Antarctica?",
            answer: "We do not ship there.",
            timestamp: "2026-02-01T10:05:00Z",
            metadata: {},
            feedback: { rating: -1, comment: null, feedback_at: null },
          },
        ],
      },
    });
    renderAt(DETAIL_PATH("sess-fb0000000000"));

    // Thumbs-up turn: "Helpful" verdict + the free-text comment, read-only.
    expect(await screen.findByText("Helpful")).toBeTruthy();
    expect(
      screen.getByText(/Exactly what I needed, thanks!/),
    ).toBeTruthy();
    expect(screen.getByLabelText("Rated helpful")).toBeTruthy();
    // Thumbs-down turn with no comment: "Not helpful", no phantom comment.
    expect(screen.getByText("Not helpful")).toBeTruthy();
    expect(screen.getByLabelText("Rated not helpful")).toBeTruthy();
    // Still fully read-only — no compose/submit affordance was introduced.
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /thumb/i })).toBeNull();
  });

  // ── #1584: per-turn tool/RAG-method attribution ────────────────────────────
  it("surfaces a turn's RAG method, model, and source count as chips (#1584)", async () => {
    mockAuth = ADMIN;
    installApi({
      detail: {
        session: session({ session_id: "sess-attr00000000", turn_count: 1 }),
        turns: [
          {
            question: "How do refunds work?",
            answer: "Within 30 days of purchase.",
            timestamp: "2026-02-01T10:00:00Z",
            metadata: {
              method: "raptor",
              pipeline_id: "pipe-1",
              model_used: "llama3:8b",
              sources_count: 4,
            },
            feedback: { rating: -1, comment: "Wrong policy", feedback_at: null },
          },
        ],
      },
    });
    renderAt(DETAIL_PATH("sess-attr00000000"));

    // The flagged answer's attribution: which method/model produced it + how many
    // sources it drew on, each read-only.
    expect(await screen.findByText("Method: raptor")).toBeTruthy();
    expect(screen.getByText("Model: llama3:8b")).toBeTruthy();
    expect(screen.getByText("4 sources")).toBeTruthy();
    // Still read-only — attribution introduces no control.
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("singularises a one-source count (#1584)", async () => {
    mockAuth = ADMIN;
    installApi({
      detail: {
        session: session({ session_id: "sess-attr1s0000000", turn_count: 1 }),
        turns: [
          {
            question: "Hours?",
            answer: "9 to 5.",
            timestamp: "2026-02-01T10:00:00Z",
            metadata: { method: "standard", model_used: "llama3:8b", sources_count: 1 },
          },
        ],
      },
    });
    renderAt(DETAIL_PATH("sess-attr1s0000000"));

    expect(await screen.findByText("1 source")).toBeTruthy();
    expect(screen.queryByText("1 sources")).toBeNull();
  });

  it("renders only the present attribution fields and omits the rest (#1584)", async () => {
    mockAuth = ADMIN;
    installApi({
      detail: {
        session: session({ session_id: "sess-attrpart00000", turn_count: 1 }),
        turns: [
          {
            question: "Where are you?",
            answer: "Remote.",
            timestamp: "2026-02-01T10:00:00Z",
            // Only method present — a partial/older turn's metadata.
            metadata: { method: "hyde" },
          },
        ],
      },
    });
    renderAt(DETAIL_PATH("sess-attrpart00000"));

    expect(await screen.findByText("Method: hyde")).toBeTruthy();
    expect(screen.queryByText(/^Model:/)).toBeNull();
    expect(screen.queryByText(/source/)).toBeNull();
  });

  it("shows no attribution block when metadata is empty (#1584)", async () => {
    mockAuth = ADMIN;
    installApi({
      detail: {
        session: session({ session_id: "sess-attrempty0000", turn_count: 1 }),
        turns: [
          {
            question: "What are your hours?",
            answer: "9 to 5, Mon-Fri.",
            timestamp: "2026-02-01T10:00:00Z",
            metadata: {},
          },
        ],
      },
    });
    renderAt(DETAIL_PATH("sess-attrempty0000"));

    expect(await screen.findByText("What are your hours?")).toBeTruthy();
    expect(screen.queryByText("Attribution")).toBeNull();
    expect(screen.queryByLabelText("Response attribution")).toBeNull();
  });

  it("does not crash when a turn omits metadata entirely (#1584)", async () => {
    mockAuth = ADMIN;
    installApi({
      detail: {
        session: session({ session_id: "sess-attrnone00000", turn_count: 1 }),
        // No `metadata` key at all on the turn.
        turns: [
          {
            question: "Ping?",
            answer: "Pong.",
            timestamp: "2026-02-01T10:00:00Z",
          },
        ],
      },
    });
    renderAt(DETAIL_PATH("sess-attrnone00000"));

    expect(await screen.findByText("Pong.")).toBeTruthy();
    expect(screen.queryByText("Attribution")).toBeNull();
  });

  it("shows no feedback verdict on an unrated turn (#1583)", async () => {
    mockAuth = ADMIN;
    installApi({
      detail: {
        session: session({ session_id: "sess-none00000000", turn_count: 1 }),
        turns: [
          {
            question: "What are your hours?",
            answer: "9 to 5, Mon-Fri.",
            timestamp: "2026-02-01T10:00:00Z",
            metadata: {},
            feedback: null,
          },
        ],
      },
    });
    renderAt(DETAIL_PATH("sess-none00000000"));

    expect(await screen.findByText("What are your hours?")).toBeTruthy();
    expect(screen.queryByText("Helpful")).toBeNull();
    expect(screen.queryByText("Not helpful")).toBeNull();
    expect(screen.queryByText("Feedback")).toBeNull();
  });

  // ── #1583: endpoint feedback summary display ───────────────────────────────
  it("shows the endpoint feedback summary above the list (#1583)", async () => {
    mockAuth = ADMIN;
    installApi({
      sessions: [session({ session_id: "sess-sum000000000", turn_count: 1 })],
      total: 1,
      summary: { endpoint_id: 7, up: 8, down: 2, total: 10, with_comments: 3 },
    });
    renderAt(LIST_PATH);

    expect(await screen.findByText("8 up")).toBeTruthy();
    expect(screen.getByText("2 down")).toBeTruthy();
    expect(screen.getByText("10 rated")).toBeTruthy();
    expect(screen.getByText("3 with comments")).toBeTruthy();
  });

  it("notes when the endpoint has no feedback yet (#1583)", async () => {
    mockAuth = ADMIN;
    installApi({
      sessions: [session({ session_id: "sess-zero00000000", turn_count: 1 })],
      total: 1,
      summary: { endpoint_id: 7, up: 0, down: 0, total: 0, with_comments: 0 },
    });
    renderAt(LIST_PATH);

    expect(
      await screen.findByText(/No feedback yet/),
    ).toBeTruthy();
  });

  it("degrades gracefully when the summary fetch errors, still listing conversations (#1583)", async () => {
    mockAuth = ADMIN;
    installApi({
      sessions: [session({ session_id: "sess-err000000000", turn_count: 4 })],
      total: 1,
      summaryError: new Error("summary unavailable"),
    });
    renderAt(LIST_PATH);

    // The list still renders; the failed summary is silently omitted, not fatal.
    expect(await screen.findByText("sess-err0000…")).toBeTruthy();
    expect(screen.getByText("4 turns")).toBeTruthy();
    expect(screen.queryByText("summary unavailable")).toBeNull();
    expect(screen.queryByLabelText("Endpoint feedback summary")).toBeNull();
  });
});
