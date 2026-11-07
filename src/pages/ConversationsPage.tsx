import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useConfirm } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { InfoCallout } from "../components/InfoCallout";
import { PageHeader } from "../components/PageHeader";
import { StatusLine } from "../components/StatusLine";
import { apiFetch, friendlyErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { destructiveButtonClass, mutedTextClass, secondaryButtonClass } from "../lib/ui";
import { usePaginatedList } from "../lib/usePaginatedList";
import { useTokenRef } from "../lib/useTokenRef";
import { useI18n } from "../i18n";

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
  onDelete,
  busy,
}: {
  conversation: ConversationSummary;
  onContinue: (conversationId: string) => void;
  onDelete: (conversation: ConversationSummary) => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const snippet = conversation.snippet || t("conversations.noQuestion");
  return (
    <section className="mb-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-gray-900 dark:text-gray-100">
            {snippet}
          </p>
          <p className={`mt-1 text-xs ${mutedTextClass}`}>
            {t("conversations.lastActive", {
              time: new Date(conversation.last_activity).toLocaleString(),
            })}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <button
            onClick={() => onContinue(conversation.conversation_id)}
            className={secondaryButtonClass}
          >
            {t("conversations.continue")} →
          </button>
          <button
            onClick={() => onDelete(conversation)}
            disabled={busy}
            aria-label={t("conversations.deleteLabel", { snippet })}
            className={destructiveButtonClass}
          >
            <Icon name="delete" size={15} /> {t("conversations.delete")}
          </button>
        </div>
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
  const { t, rich } = useI18n();
  const { token, sessionKey } = useAuth();
  const tokenRef = useTokenRef();
  const navigate = useNavigate();
  const { confirm, dialog } = useConfirm();
  // Deleted ids are hidden locally so the loaded "more" pages survive (#172).
  const [deleted, setDeleted] = useState<ReadonlySet<string>>(() => new Set());
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteStatus, setDeleteStatus] = useState<{ text: string; error: boolean } | null>(null);

  // Server-side deletions shift later pages back; the hook counts the hidden
  // rows in its offset, so subtract them or "Load more" skips a row each.
  const deletedSinceReload = useRef(0);
  // Deletions since the last page arrived, to correct that page's stale total.
  const deletedSinceFetch = useRef(0);
  const statusRef = useRef<HTMLDivElement>(null);

  const fetchConversationsPage = useCallback(
    async (offset: number) => {
      if (offset === 0) deletedSinceReload.current = 0;
      deletedSinceFetch.current = 0;
      const res = await apiFetch<ConversationsResponse>(
        `/v1/conversations/mine?limit=20&offset=${Math.max(0, offset - deletedSinceReload.current)}`,
        { token: tokenRef.current },
      );
      return { items: res.items, total: res.total };
    },
    // Not the token (#55): it changes on every silent refresh, and a new
    // fetchPage would re-run the effect below and drop the "load more" pages.
    [tokenRef],
  );
  const {
    items: conversations,
    total,
    status,
    isError: isStatusError,
    reload,
    loadMore,
  } = usePaginatedList(fetchConversationsPage);

  useEffect(() => {
    if (sessionKey) reload();
  }, [sessionKey, reload]);

  function handleContinue(conversationId: string) {
    // Ask is the canonical query surface now (#1229) — it already supports
    // continuing a thread from a conversation_id query param.
    navigate(`/ask?conversation_id=${encodeURIComponent(conversationId)}`);
  }

  async function handleDelete(c: ConversationSummary) {
    const ok = await confirm({
      title: t("conversations.deleteTitle"),
      message: t("conversations.deleteMessage"),
      danger: true,
    });
    if (!ok) return;
    setDeleting(c.conversation_id);
    setDeleteStatus(null);
    try {
      await apiFetch(`/v1/conversations/${encodeURIComponent(c.conversation_id)}`, {
        method: "DELETE",
        token: tokenRef.current,
      });
      deletedSinceReload.current += 1;
      deletedSinceFetch.current += 1;
      setDeleted((prev) => new Set(prev).add(c.conversation_id));
      setDeleteStatus({ text: t("conversations.deleted"), error: false });
      // The focused Delete button is gone; keep keyboard focus on the result.
      statusRef.current?.focus();
    } catch (e) {
      setDeleteStatus({
        text: t("conversations.deleteFailed", { error: friendlyErrorMessage(e) }),
        error: true,
      });
    } finally {
      setDeleting(null);
    }
  }

  const shown = conversations.filter((c) => !deleted.has(c.conversation_id));
  // What's still on the server vs. what's still on screen, both net of deletes.
  const hasMore = total - deletedSinceFetch.current > conversations.length - deletedSinceReload.current;

  return (
    <>
      {dialog}
      <PageHeader
        icon="conversations"
        title="Conversations"
        subtitle={t("conversations.subtitle")}
      />
      {!token && (
        <InfoCallout icon="lock">Log in to see your conversation history.</InfoCallout>
      )}
      {token && (
        <>
          <StatusLine isError={isStatusError}>{status}</StatusLine>
          <div ref={statusRef} tabIndex={-1} className="outline-none">
            {deleteStatus && (
              <StatusLine isError={deleteStatus.error}>{deleteStatus.text}</StatusLine>
            )}
          </div>
          {shown.length === 0 && !status && !hasMore && (
            <EmptyState>
              {rich("conversations.empty", { chat: <strong>{t("nav.items.chat.label")}</strong> })}
            </EmptyState>
          )}
          {shown.map((c) => (
            <ConversationCard
              key={c.conversation_id}
              conversation={c}
              onContinue={handleContinue}
              onDelete={(conv) => void handleDelete(conv)}
              busy={deleting === c.conversation_id}
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
