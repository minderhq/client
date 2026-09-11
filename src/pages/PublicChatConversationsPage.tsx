import { useCallback, useEffect } from "react";
import { Link, useParams } from "react-router-dom";

import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { InfoCallout } from "../components/InfoCallout";
import { PageHeader } from "../components/PageHeader";
import { StatusLine } from "../components/StatusLine";
import { apiFetch } from "../lib/api";
import type { Paginated } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  badgeClass,
  badgeTone,
  mutedTextClass,
  secondaryButtonClass,
  surfaceMutedClass,
} from "../lib/ui";
import { useAsyncResource } from "../lib/useAsyncResource";
import { usePaginatedList } from "../lib/usePaginatedList";
import type { PublicChatEndpoint } from "./PublicChatEndpointsPage";

// #1582 (client half): the creator conversation dashboard. An endpoint owner
// reads the anonymous conversations that flowed through THEIR public chat
// endpoint — the list of sessions, then a drill-in to one session's turns
// (the external user's questions + the bot's answers), read-only.
//
// Admin-gated exactly like PublicChatEndpointsPage (mirrors the backend's
// _require_endpoint_admin). Ownership is server-enforced: a cross-tenant /
// other-owner endpoint id 404s at the gateway, so this view never surfaces
// another org's conversations.
//
// #1583 (client half): CREATOR-side feedback DISPLAY. The backend (minder PR
// #1606) folds each turn's anonymous end-user rating (thumbs up/down + optional
// comment) into the conversation-detail read, and adds a per-endpoint feedback
// summary. Here we surface both, read-only: the per-turn rating on each turn
// card, and the endpoint's up/down/total/with-comments summary above the list.
// The EXTERNAL end-user thumbs-SUBMISSION control is deliberately OUT of scope —
// it belongs to the public embeddable widget (a separate future issue; that UI
// doesn't exist yet). Tool/RAG attribution (#1584) stays a follow-up too.

/** One anonymous session row from
 * GET /v1/public-chat/endpoints/{id}/conversations (the gateway proxies
 * rag-pipeline's session registry — see routes/public_chat.py). Timestamps come
 * from the DB's NOW() so are normally present, but typed nullable defensively. */
export interface EndpointConversation {
  session_id: string;
  tenant_id: string;
  created_at: string | null;
  last_active_at: string | null;
  turn_count: number;
}

/** The anonymous end user's rating of one turn's answer (#1583), as folded into
 * the conversation-detail read by the gateway. `rating` is +1 (thumbs up) / -1
 * (thumbs down); the optional `comment` is their free-text note. Absent on a
 * turn nobody rated (the turn's `feedback` is then null). */
export interface TurnFeedback {
  rating: number;
  comment: string | null;
  feedback_at: string | null;
}

/** One question/answer exchange within a session. `metadata` is carried but not
 * surfaced yet — tool/RAG attribution off it is #1584. `feedback` is the
 * end user's rating of THIS answer, or null/absent when unrated (#1583). */
export interface ConversationTurn {
  question: string;
  answer: string;
  timestamp: string | null;
  metadata?: Record<string, unknown>;
  feedback?: TurnFeedback | null;
}

/** GET /v1/public-chat/endpoints/{id}/feedback — the at-a-glance rating tally for
 * an endpoint's answers (#1583). `with_comments` counts ratings that also left a
 * free-text note. Tenant-scoped server-side, so it only ever covers this
 * endpoint's own feedback. */
export interface EndpointFeedbackSummary {
  endpoint_id?: number | string;
  up: number;
  down: number;
  total: number;
  with_comments: number;
}

/** GET /v1/public-chat/endpoints/{id}/conversations/{session_id} — the session's
 * metadata plus its turns (oldest-first). */
export interface ConversationDetailResponse {
  session: EndpointConversation;
  turns: ConversationTurn[];
}

/** Human timestamp, or an em-dash when the backend sent null/garbage — never
 * render a raw ISO string or "Invalid Date" at the user. */
function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/** A session id is opaque and long; show a short, monospaced prefix so the list
 * stays scannable while the full id is still the drill-in target. */
function shortSessionId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 12)}…` : id;
}

function ConversationList({
  endpointId,
  token,
}: {
  endpointId: string;
  token: string;
}) {
  const fetchPage = useCallback(
    async (offset: number) => {
      const res = await apiFetch<Paginated<EndpointConversation>>(
        `/v1/public-chat/endpoints/${endpointId}/conversations?limit=20&offset=${offset}`,
        { token },
      );
      return { items: res.items, total: res.total };
    },
    [endpointId, token],
  );

  const {
    items: conversations,
    total,
    status,
    isError,
    reload,
    loadMore,
    hasMore,
  } = usePaginatedList(fetchPage);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <>
      <StatusLine isError={isError}>{status}</StatusLine>

      {!status && conversations.length === 0 && (
        <EmptyState>
          No conversations yet — sessions appear here once someone chats with
          this endpoint's public address.
        </EmptyState>
      )}

      {conversations.length > 0 && (
        <p className={`mb-3 ${mutedTextClass}`}>
          {total} conversation{total === 1 ? "" : "s"}, most recently active
          first.
        </p>
      )}

      {conversations.map((c) => (
        <Link
          key={c.session_id}
          to={`/rag/public-chat/${endpointId}/conversations/${encodeURIComponent(c.session_id)}`}
          className="mb-2 flex items-center gap-3 rounded-lg border border-gray-200 p-3 text-sm transition hover:border-indigo-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:border-indigo-800 dark:hover:bg-gray-800/50"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-gray-900 dark:text-gray-100">
                {shortSessionId(c.session_id)}
              </span>
              <span className={badgeClass}>
                {c.turn_count} turn{c.turn_count === 1 ? "" : "s"}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
              <span>Last active {formatTimestamp(c.last_active_at)}</span>
              <span aria-hidden="true">·</span>
              <span>Started {formatTimestamp(c.created_at)}</span>
            </div>
          </div>
          <Icon name="chevron-right" size={16} />
        </Link>
      ))}

      {hasMore && (
        <button onClick={loadMore} className={secondaryButtonClass}>
          Load more
        </button>
      )}
    </>
  );
}

/** Read-only display of the end user's rating on one turn (#1583). Thumbs up →
 * a green "Helpful" pill, thumbs down → a red "Not helpful" one, plus the
 * free-text comment when they left one. Rendered only when the turn was rated. */
function TurnFeedbackBadge({ feedback }: { feedback: TurnFeedback }) {
  const up = feedback.rating > 0;
  return (
    <div className="mt-3">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        Feedback
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
            up ? badgeTone.success : badgeTone.danger
          }`}
        >
          <Icon
            name={up ? "thumbs-up" : "thumbs-down"}
            size={12}
            aria-hidden={false}
            aria-label={up ? "Rated helpful" : "Rated not helpful"}
          />
          {up ? "Helpful" : "Not helpful"}
        </span>
        {feedback.feedback_at && (
          <span className="text-xs text-gray-400 dark:text-gray-500">
            rated {formatTimestamp(feedback.feedback_at)}
          </span>
        )}
      </div>
      {feedback.comment && (
        <p className="mt-2 whitespace-pre-wrap rounded-md bg-white px-2.5 py-1.5 text-xs text-gray-700 ring-1 ring-gray-200 dark:bg-gray-900 dark:text-gray-300 dark:ring-gray-700">
          “{feedback.comment}”
        </p>
      )}
    </div>
  );
}

function ConversationTurnCard({ turn }: { turn: ConversationTurn }) {
  return (
    <div className={`mb-3 ${surfaceMutedClass} p-3 text-sm`}>
      <div>
        <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          <Icon name="user" size={13} /> Question
        </div>
        <p className="whitespace-pre-wrap text-gray-900 dark:text-gray-100">
          {turn.question}
        </p>
      </div>
      <div className="mt-3">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          <Icon name="ask" size={13} /> Answer
        </div>
        <p className="whitespace-pre-wrap text-gray-800 dark:text-gray-200">
          {turn.answer}
        </p>
      </div>
      {turn.feedback && <TurnFeedbackBadge feedback={turn.feedback} />}
      {turn.timestamp && (
        <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
          {formatTimestamp(turn.timestamp)}
        </p>
      )}
    </div>
  );
}

/** The endpoint's at-a-glance feedback tally (#1583), shown above the
 * conversations/detail. Supplementary chrome: while it's loading or if the
 * summary fetch fails, we render nothing rather than block the page the creator
 * actually came for. A zero-total endpoint gets a plain "no feedback yet" note. */
function FeedbackSummaryBar({
  endpointId,
  token,
}: {
  endpointId: string;
  token: string;
}) {
  const summaryRes = useAsyncResource(
    (signal) =>
      apiFetch<EndpointFeedbackSummary>(
        `/v1/public-chat/endpoints/${endpointId}/feedback`,
        { token, signal },
      ),
    { deps: [endpointId] },
  );

  const s = summaryRes.data;
  if (!s) return null;

  if (!s.total) {
    return (
      <p className={`mb-4 ${mutedTextClass}`}>
        No feedback yet — end users haven't rated any answers on this endpoint.
      </p>
    );
  }

  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-2"
      aria-label="Endpoint feedback summary"
    >
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeTone.success}`}
      >
        <Icon name="thumbs-up" size={12} /> {s.up} up
      </span>
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeTone.danger}`}
      >
        <Icon name="thumbs-down" size={12} /> {s.down} down
      </span>
      <span className={badgeClass}>{s.total} rated</span>
      <span className={badgeClass}>
        {s.with_comments} with comment{s.with_comments === 1 ? "" : "s"}
      </span>
    </div>
  );
}

function ConversationDetail({
  endpointId,
  sessionId,
  token,
}: {
  endpointId: string;
  sessionId: string;
  token: string;
}) {
  const detailRes = useAsyncResource(
    (signal) =>
      apiFetch<ConversationDetailResponse>(
        `/v1/public-chat/endpoints/${endpointId}/conversations/${encodeURIComponent(sessionId)}`,
        { token, signal },
      ),
    { deps: [endpointId, sessionId] },
  );

  const backLink = (
    <Link
      to={`/rag/public-chat/${endpointId}/conversations`}
      className={secondaryButtonClass}
    >
      <Icon name="arrow" size={14} /> Back to conversations
    </Link>
  );

  if (detailRes.error) {
    // A 404 here (session not this endpoint+tenant's) carries the backend's
    // "Conversation not found"; any other failure shows its message. Both read
    // as "this conversation isn't available", with a way back to the list.
    return (
      <>
        <div className="mb-3">{backLink}</div>
        <InfoCallout icon="warning">{detailRes.error}</InfoCallout>
      </>
    );
  }

  const turns = detailRes.data?.turns ?? [];
  const session = detailRes.data?.session;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {backLink}
        {session && (
          <span className={badgeClass}>
            {session.turn_count} turn{session.turn_count === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <p className={`mb-3 ${mutedTextClass}`}>
        Session <span className="font-mono">{sessionId}</span>
        {session?.last_active_at && (
          <> · last active {formatTimestamp(session.last_active_at)}</>
        )}
      </p>

      <StatusLine>{detailRes.loading ? "Loading…" : ""}</StatusLine>

      {!detailRes.loading && turns.length === 0 && (
        <EmptyState>This conversation has no recorded turns.</EmptyState>
      )}

      {turns.map((turn, i) => (
        <ConversationTurnCard key={i} turn={turn} />
      ))}
    </>
  );
}

export function PublicChatConversationsPage() {
  const { endpointId = "", sessionId } = useParams();
  const { token, role, orgRole, isPlatformAdmin } = useAuth();
  // Same gate as PublicChatEndpointsPage / the backend's _require_endpoint_admin:
  // reading an endpoint's conversations is an owner/admin action.
  const isAdmin =
    isPlatformAdmin ||
    role === "admin" ||
    orgRole === "owner" ||
    orgRole === "admin";

  // The endpoint's own metadata — gives the header its name AND is the ownership
  // gate: a cross-tenant/other-owner id 404s here (server-enforced), so we never
  // render a list/detail for an endpoint the caller doesn't own.
  const endpointRes = useAsyncResource(
    (signal) =>
      apiFetch<PublicChatEndpoint>(
        `/v1/public-chat/endpoints/${endpointId}`,
        { token, signal },
      ),
    { enabled: isAdmin && !!endpointId, deps: [endpointId] },
  );

  const endpointName = endpointRes.data?.name;

  return (
    <>
      <PageHeader
        icon="conversations"
        title="Conversations"
        subtitle={
          endpointName
            ? `Anonymous conversations through your "${endpointName}" public chat endpoint, read-only.`
            : "Anonymous conversations through your public chat endpoint, read-only."
        }
        actions={
          <Link to="/rag/public-chat" className={secondaryButtonClass}>
            <Icon name="arrow" size={14} /> All endpoints
          </Link>
        }
      />

      {!isAdmin && (
        <InfoCallout icon="lock">
          {token
            ? "Admin role required to view public chat conversations."
            : "Log in as an admin to view public chat conversations."}
        </InfoCallout>
      )}

      {isAdmin && (
        <>
          {endpointRes.loading && <StatusLine>Loading…</StatusLine>}

          {endpointRes.error && (
            <InfoCallout icon="warning">{endpointRes.error}</InfoCallout>
          )}

          {!endpointRes.loading && !endpointRes.error && (
            <>
              {/* Endpoint-level feedback tally (#1583) — relevant on both the
                  list overview and a single conversation's drill-in. */}
              <FeedbackSummaryBar endpointId={endpointId} token={token} />

              {sessionId ? (
                <ConversationDetail
                  endpointId={endpointId}
                  sessionId={sessionId}
                  token={token}
                />
              ) : (
                <ConversationList endpointId={endpointId} token={token} />
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
