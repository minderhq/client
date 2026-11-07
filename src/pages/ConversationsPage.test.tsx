import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationsPage } from "./ConversationsPage";

const apiFetch = vi.fn();

vi.mock("../lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  friendlyErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
}));

const SESSION = "1:7:1";
let mockAuth = { token: "", sessionKey: "" };
vi.mock("../lib/auth", () => ({
  useAuth: () => mockAuth,
}));

const confirmMock = vi.fn();
vi.mock("../components/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: confirmMock, dialog: null }),
}));

const navigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
}));

function conversation(overrides: Partial<{
  conversation_id: string;
  last_activity: string;
  snippet: string;
}> = {}) {
  return {
    conversation_id: overrides.conversation_id ?? "conv-1",
    last_activity: overrides.last_activity ?? "2026-01-01T00:00:00Z",
    snippet: overrides.snippet ?? "what is the refund policy?",
  };
}

describe("ConversationsPage", () => {
  afterEach(() => {
    cleanup();
    apiFetch.mockReset();
    navigate.mockReset();
  });

  it("prompts to log in and never fetches when there's no token", () => {
    mockAuth = { token: "", sessionKey: "" };
    render(<ConversationsPage />);

    expect(
      screen.getByText("Log in to see your conversation history."),
    ).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("shows an empty state when the caller has no conversations", async () => {
    mockAuth = { token: "tok", sessionKey: SESSION };
    apiFetch.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
    render(<ConversationsPage />);

    await screen.findByText(/No conversations yet — start one in/);
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/conversations/mine?limit=20&offset=0",
      { token: "tok" },
    );
  });

  it("renders a card per conversation with its snippet and last-activity time", async () => {
    mockAuth = { token: "tok", sessionKey: SESSION };
    apiFetch.mockResolvedValue({
      items: [
        conversation({ conversation_id: "conv-1", snippet: "what is the refund policy?" }),
        conversation({ conversation_id: "conv-2", snippet: "how do I reset my password?" }),
      ],
      total: 2,
      limit: 20,
      offset: 0,
    });
    render(<ConversationsPage />);

    await screen.findByText("what is the refund policy?");
    expect(screen.getByText("how do I reset my password?")).toBeTruthy();
  });

  it("falls back to a placeholder when a conversation has no snippet", async () => {
    mockAuth = { token: "tok", sessionKey: SESSION };
    apiFetch.mockResolvedValue({
      items: [conversation({ snippet: "" })],
      total: 1,
      limit: 20,
      offset: 0,
    });
    render(<ConversationsPage />);

    await screen.findByText("(no question recorded)");
  });

  it("navigates to Ask with the chosen conversation_id when Continue is clicked", async () => {
    mockAuth = { token: "tok", sessionKey: SESSION };
    apiFetch.mockResolvedValue({
      items: [conversation({ conversation_id: "conv-xyz" })],
      total: 1,
      limit: 20,
      offset: 0,
    });
    render(<ConversationsPage />);

    await screen.findByText("what is the refund policy?");
    fireEvent.click(screen.getByText("Continue →"));

    expect(navigate).toHaveBeenCalledWith("/ask?conversation_id=conv-xyz");
  });

  it("shows a Load more button when more results exist, and fetches the next page", async () => {
    mockAuth = { token: "tok", sessionKey: SESSION };
    apiFetch.mockResolvedValueOnce({
      items: [conversation({ conversation_id: "conv-1" })],
      total: 2,
      limit: 20,
      offset: 0,
    });
    render(<ConversationsPage />);
    await screen.findByText("what is the refund policy?");

    apiFetch.mockResolvedValueOnce({
      items: [conversation({ conversation_id: "conv-2", snippet: "second one" })],
      total: 2,
      limit: 20,
      offset: 20,
    });
    fireEvent.click(screen.getByText("Load more"));

    await screen.findByText("second one");
    expect(apiFetch).toHaveBeenLastCalledWith(
      "/v1/conversations/mine?limit=20&offset=20",
      { token: "tok" },
    );
  });

  it("shows a friendly status message when the fetch fails", async () => {
    mockAuth = { token: "tok", sessionKey: SESSION };
    apiFetch.mockRejectedValue(new Error("network down"));
    render(<ConversationsPage />);

    await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
    expect(screen.getByText("network down")).toBeTruthy();
  });

  describe("across a token change (#55)", () => {
    async function renderWithTwoPages() {
      mockAuth = { token: "tok", sessionKey: SESSION };
      apiFetch.mockResolvedValueOnce({
        items: [conversation({ conversation_id: "conv-1" })],
        total: 3,
        limit: 20,
        offset: 0,
      });
      const view = render(<ConversationsPage />);
      await screen.findByText("what is the refund policy?");
      apiFetch.mockResolvedValueOnce({
        items: [conversation({ conversation_id: "conv-2", snippet: "second one" })],
        total: 3,
        limit: 20,
        offset: 20,
      });
      fireEvent.click(screen.getByText("Load more"));
      await screen.findByText("second one");
      expect(apiFetch).toHaveBeenCalledTimes(2);
      return view;
    }

    it("a silent refresh neither refetches nor drops the expanded pages", async () => {
      const { rerender } = await renderWithTwoPages();

      // Same user and org, new token string.
      mockAuth = { token: "tok-refreshed", sessionKey: SESSION };
      rerender(<ConversationsPage />);

      expect(apiFetch).toHaveBeenCalledTimes(2);
      expect(screen.getByText("what is the refund policy?")).toBeTruthy();
      expect(screen.getByText("second one")).toBeTruthy();

      // The next page is fetched with the refreshed token, not a stale one.
      apiFetch.mockResolvedValueOnce({
        items: [conversation({ conversation_id: "conv-3", snippet: "third one" })],
        total: 3,
        limit: 20,
        offset: 40,
      });
      fireEvent.click(screen.getByText("Load more"));
      await screen.findByText("third one");
      expect(apiFetch).toHaveBeenLastCalledWith(
        "/v1/conversations/mine?limit=20&offset=40",
        { token: "tok-refreshed" },
      );
      expect(screen.getByText("second one")).toBeTruthy();
    });

    it("an org switch still refetches from the first page", async () => {
      const { rerender } = await renderWithTwoPages();

      apiFetch.mockResolvedValueOnce({
        items: [conversation({ conversation_id: "conv-9", snippet: "other org" })],
        total: 1,
        limit: 20,
        offset: 0,
      });
      mockAuth = { token: "tok-org2", sessionKey: "2:7:2" };
      rerender(<ConversationsPage />);

      await screen.findByText("other org");
      expect(apiFetch).toHaveBeenLastCalledWith(
        "/v1/conversations/mine?limit=20&offset=0",
        { token: "tok-org2" },
      );
      expect(screen.queryByText("second one")).toBeNull();
    });
  });

  describe("delete a conversation (#172)", () => {
    function page(items: ReturnType<typeof conversation>[], total = items.length, offset = 0) {
      return { items, total, limit: 20, offset };
    }

    it("deletes after confirmation and hides the row", async () => {
      mockAuth = { token: "tok", sessionKey: SESSION };
      confirmMock.mockResolvedValue(true);
      apiFetch.mockResolvedValueOnce(page([conversation()])).mockResolvedValueOnce({});
      render(<ConversationsPage />);

      fireEvent.click(
        await screen.findByRole("button", { name: "Delete conversation: what is the refund policy?" }),
      );

      await screen.findByText("Conversation deleted.");
      expect(apiFetch).toHaveBeenLastCalledWith("/v1/conversations/conv-1", {
        method: "DELETE",
        token: "tok",
      });
      expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ danger: true }));
      expect(screen.queryByText("what is the refund policy?")).toBeNull();
    });

    it("does nothing when the confirmation is cancelled", async () => {
      mockAuth = { token: "tok", sessionKey: SESSION };
      confirmMock.mockResolvedValue(false);
      apiFetch.mockResolvedValueOnce(page([conversation()]));
      render(<ConversationsPage />);

      fireEvent.click(await screen.findByRole("button", { name: /Delete conversation/ }));

      await waitFor(() => expect(confirmMock).toHaveBeenCalled());
      expect(apiFetch).toHaveBeenCalledTimes(1);
      expect(screen.getByText("what is the refund policy?")).toBeTruthy();
    });

    it("keeps the row and reports the error when the delete fails", async () => {
      mockAuth = { token: "tok", sessionKey: SESSION };
      confirmMock.mockResolvedValue(true);
      apiFetch
        .mockResolvedValueOnce(page([conversation()]))
        .mockRejectedValueOnce(new Error("Conversation not found"));
      render(<ConversationsPage />);

      fireEvent.click(await screen.findByRole("button", { name: /Delete conversation/ }));

      await screen.findByText("Couldn't delete the conversation. Conversation not found");
      expect(screen.getByText("what is the refund policy?")).toBeTruthy();
    });

    it("loads the next page from the shifted offset after a delete", async () => {
      mockAuth = { token: "tok", sessionKey: SESSION };
      confirmMock.mockResolvedValue(true);
      const first = Array.from({ length: 20 }, (_, n) =>
        conversation({ conversation_id: `c${n}`, snippet: `question ${n}` }),
      );
      apiFetch
        .mockResolvedValueOnce(page(first, 25))
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce(page([conversation({ conversation_id: "c20", snippet: "question 20" })], 25, 19));
      render(<ConversationsPage />);

      fireEvent.click(await screen.findByRole("button", { name: "Delete conversation: question 0" }));
      await screen.findByText("Conversation deleted.");
      fireEvent.click(screen.getByText("Load more"));

      await screen.findByText("question 20");
      expect(apiFetch).toHaveBeenLastCalledWith("/v1/conversations/mine?limit=20&offset=19", {
        token: "tok",
      });
    });
  });
});
