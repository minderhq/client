import { useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { EmptyState } from "../components/EmptyState";
import { InfoCallout } from "../components/InfoCallout";
import { PageHeader } from "../components/PageHeader";
import { StatusLine } from "../components/StatusLine";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth";
import { mutedTextClass, secondaryButtonClass } from "../lib/ui";
import { usePaginatedList } from "../lib/usePaginatedList";

export interface ConversationSummary {
  conversation_id: string;
  last_activity: string;
  snippet: string;
}

interface ConversationsResponse {
  items: ConversationSummary[];
  total: number;
  limit: number;
  offset: number;
}

function ConversationCard({
  conversation,
  onContinue,
}: {
  conversation: ConversationSummary;
  onContinue: (conversationId: string) => void;
}) {
  return (
    <section className="mb-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-gray-900 dark:text-gray-100">
            {conversation.snippet || "(no question recorded)"}
          </p>
          <p className={`mt-1 text-xs ${mutedTextClass}`}>
            Last active {new Date(conversation.last_activity).toLocaleString()}
          </p>
        </div>
        <button
          onClick={() => onContinue(conversation.conversation_id)}
          className={secondaryButtonClass}
        >
          Continue →
        </button>
      </div>
    </section>
  );
}

/** #402-roadmap follow-up: previously a conversation could only be continued
 * if the caller already knew its conversation_id. Lists the caller's own past
 * conversations (`GET /v1/conversations/mine`) and hands off to **Ask** — the
 * canonical query surface (#1229) — with the chosen id pre-filled via a query
 * param, so continuing a thread lands where you'd start a new one.
 *
 * Strictly the caller's own conversations -- one someone else started and
 * merely shared WITH the caller intentionally doesn't appear here (see the
 * backend's `list_owned_conversations`); this is "conversations I began,"
 * not "conversations I can see." */
export function ConversationsPage() {
  const { token } = useAuth();
  const navigate = useNavigate();

  const fetchConversationsPage = useCallback(
    async (offset: number) => {
      const res = await apiFetch<ConversationsResponse>(
        `/v1/conversations/mine?limit=20&offset=${offset}`,
        { token },
      );
      return { items: res.items, total: res.total };
    },
    [token],
  );
  const {
    items: conversations,
    status,
    isError: isStatusError,
    reload,
    loadMore,
    hasMore,
  } = usePaginatedList(fetchConversationsPage);

  useEffect(() => {
    if (token) reload();
  }, [token, reload]);

  function handleContinue(conversationId: string) {
    // Ask is the canonical query surface now (#1229) — it already supports
    // continuing a thread from a conversation_id query param.
    navigate(`/ask?conversation_id=${encodeURIComponent(conversationId)}`);
  }

  return (
    <>
      <PageHeader
        icon="conversations"
        title="Conversations"
        subtitle="Conversations you've started, across any pipeline, most recently active first."
      />
      {!token && (
        <InfoCallout icon="lock">Log in to see your conversation history.</InfoCallout>
      )}
      {token && (
        <>
          <StatusLine isError={isStatusError}>{status}</StatusLine>
          {conversations.length === 0 && !status && (
            <EmptyState>
              No conversations yet — start one in{" "}
              <strong>Ask</strong> (its follow-up questions form a thread you
              can return to here).
            </EmptyState>
          )}
          {conversations.map((c) => (
            <ConversationCard
              key={c.conversation_id}
              conversation={c}
              onContinue={handleContinue}
            />
          ))}
          {hasMore && (
            <button onClick={loadMore} className={secondaryButtonClass}>
              Load more
            </button>
          )}
        </>
      )}
    </>
  );
}
