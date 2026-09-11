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

/** Route apiFetch by path so the endpoint-metadata GET, the sessions list, and
 * the single-conversation GET each resolve independently of call order. */
function installApi(opts: {
  endpoint?: unknown;
  endpointError?: Error;
  sessions?: unknown[];
  total?: number;
  sessionsError?: Error;
  detail?: unknown;
  detailError?: Error;
} = {}) {
  const {
    endpoint = ENDPOINT,
    endpointError,
    sessions = [],
    total,
    sessionsError,
    detail,
    detailError,
  } = opts;
  apiFetch.mockImplementation((path: string) => {
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
});
