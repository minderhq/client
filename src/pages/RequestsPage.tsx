import { useId, useState } from "react";

import { Dialog } from "../components/Dialog";
import { EmptyState } from "../components/EmptyState";
import { LoadError } from "../components/LoadError";
import { PageHeader } from "../components/PageHeader";
import { Skeleton } from "../components/Skeleton";
import { StatusLine } from "../components/StatusLine";
import { useI18n, type Messages } from "../i18n";
import { friendlyErrorMessage } from "../lib/api";
import {
  approveAccessRequest,
  denyAccessRequest,
  fetchMyAccessRequests,
  fetchRequestInbox,
  isAlreadyDecided,
  notifyRequestsChanged,
  useCanDecideRequests,
  type InboxRequest,
  type MyAccessRequest,
} from "../lib/accessRequests";
import { useAuth } from "../lib/auth";
import {
  badgeBaseClass,
  badgeNeutralToneClass,
  badgeTone,
  cardClass,
  destructiveButtonClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../lib/ui";
import { useAsyncResource } from "../lib/useAsyncResource";
import { useModal } from "../lib/useModal";

type Kind = keyof Messages["requests"]["kinds"];
type Status = keyof Messages["requests"]["status"];
type FollowUp = keyof Messages["requests"]["followUp"];

const STATUS_TONE: Record<Status, string> = {
  pending: badgeTone.warn,
  approved: badgeTone.success,
  denied: badgeTone.danger,
  expired: badgeNeutralToneClass,
  withdrawn: badgeNeutralToneClass,
};

function StatusBadgeFor({ status }: { status: string }) {
  const { t, messages } = useI18n();
  const known = Object.hasOwn(messages.requests.status, status);
  return (
    <span className={`${badgeBaseClass} ${known ? STATUS_TONE[status as Status] : badgeNeutralToneClass}`}>
      {known ? t(`requests.status.${status as Status}`) : status}
    </span>
  );
}

/** "Install a plugin: Weather", "Join a team: Sales". */
function useDescribe() {
  const { t, messages } = useI18n();
  return (r: MyAccessRequest & { team_name?: string | null }) => {
    const kind = Object.hasOwn(messages.requests.kinds, r.kind)
      ? t(`requests.kinds.${r.kind as Kind}`)
      : r.kind;
    const what =
      r.subject ??
      r.team_name ??
      (r.team_id != null ? t("requests.teamNumber", { id: r.team_id }) : r.organization_name);
    return what ? `${kind}: ${what}` : kind;
  };
}

/** Requests (client#126 Q4): what the caller asked for and how it went, and,
 * for whoever decides requests, the ones routed to them with approve and
 * reject. The first decision closes a request for every recipient, so a
 * decided one shows who decided it. */
export function RequestsPage() {
  const { token, sessionKey } = useAuth();
  const { t } = useI18n();
  const canDecide = useCanDecideRequests();
  const inboxHeadingId = useId();
  const mineHeadingId = useId();

  const mine = useAsyncResource((signal) => fetchMyAccessRequests(token, signal), {
    enabled: !!token,
    deps: [sessionKey],
  });
  // Asked of everyone: a team admin's join requests are routed to them even
  // when the session can't tell they are one.
  const inbox = useAsyncResource((signal) => fetchRequestInbox("all", token, signal), {
    enabled: !!token,
    deps: [sessionKey],
  });
  const inboxItems = inbox.data?.requests ?? [];
  const showInbox = canDecide || inboxItems.length > 0;

  return (
    <>
      <PageHeader icon="send" title={t("nav.items.requests.title")} subtitle={t("requests.page.subtitle")} />

      {showInbox && (
        <section aria-labelledby={inboxHeadingId} className="mb-8">
          <h2 id={inboxHeadingId} className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">
            {t("requests.page.inboxHeading")}
          </h2>
          {inbox.loading && !inbox.data ? (
            <Skeleton className="h-24 w-full" />
          ) : inbox.error ? (
            <LoadError
              title={t("requests.page.inboxLoadError")}
              message={inbox.error}
              onRetry={inbox.reload}
              what={t("requests.page.inboxHeading")}
            />
          ) : inboxItems.length === 0 ? (
            <EmptyState>{t("requests.page.inboxEmpty")}</EmptyState>
          ) : (
            <ul className="flex flex-col gap-3">
              {inboxItems.map((r) => (
                <InboxItem key={r.id} request={r} onChanged={inbox.reload} />
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby={mineHeadingId}>
        <h2 id={mineHeadingId} className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">
          {t("requests.page.mineHeading")}
        </h2>
        {mine.loading && !mine.data ? (
          <Skeleton className="h-24 w-full" />
        ) : mine.error ? (
          <LoadError
            title={t("requests.page.mineLoadError")}
            message={mine.error}
            onRetry={mine.reload}
            what={t("requests.page.mineHeading")}
          />
        ) : (mine.data?.requests ?? []).length === 0 ? (
          <EmptyState>{t("requests.page.mineEmpty")}</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {(mine.data?.requests ?? []).map((r) => (
              <MyRequestItem key={r.id} request={r} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function MyRequestItem({ request: r }: { request: MyAccessRequest }) {
  const { t, formatDate } = useI18n();
  const describe = useDescribe();
  const date = (value: string) => formatDate(value, { dateStyle: "medium" });
  return (
    <li className={cardClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-gray-900 dark:text-gray-100">{describe(r)}</p>
        <StatusBadgeFor status={r.status} />
      </div>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {[
          r.created_at ? t("requests.page.sentOn", { date: date(r.created_at) }) : "",
          r.status === "pending" && r.expires_at
            ? t("requests.page.expiresOn", { date: date(r.expires_at) })
            : "",
          r.status !== "pending" && r.decided_at
            ? t("requests.page.decidedOn", { date: date(r.decided_at) })
            : "",
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {r.decision_reason && (
        <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
          {t("requests.reason", { reason: r.decision_reason })}
        </p>
      )}
    </li>
  );
}

function InboxItem({ request: r, onChanged }: { request: InboxRequest; onChanged: () => void }) {
  const { token } = useAuth();
  const { t, formatDate, messages } = useI18n();
  const describe = useDescribe();
  const ids = useId();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const modal = useModal({ open: rejecting, onDismiss: () => !busy && closeReject() });

  const who = r.requester.username || r.requester.email || t("requests.page.someone");
  const what = describe(r);
  const decider = r.decided_by_username || t("requests.page.someone");

  function closeReject() {
    modal.close();
    setRejecting(false);
    setReason("");
  }

  /** Run a decision; `action` resolves to the message to show. Whatever the
   * outcome, the list reloads: on a 409 another recipient decided first, and
   * the reloaded item says who. */
  async function decide(action: () => Promise<string>) {
    setBusy(true);
    setIsError(false);
    setMessage("");
    try {
      setMessage(await action());
    } catch (e) {
      setIsError(true);
      setMessage(isAlreadyDecided(e) ? t("requests.page.alreadyDecided") : friendlyErrorMessage(e));
    }
    setBusy(false);
    notifyRequestsChanged();
    onChanged();
  }

  function approve() {
    void decide(async () => {
      const res = await approveAccessRequest(r.organization_id as number, r.id, token);
      // Approving a plugin, model or plan only records it: say what's next.
      const followUp = res.follow_up;
      return followUp && Object.hasOwn(messages.requests.followUp, followUp)
        ? t(`requests.followUp.${followUp as FollowUp}`)
        : t("requests.page.approved");
    });
  }

  async function reject(e: React.FormEvent) {
    e.preventDefault();
    await decide(async () => {
      await denyAccessRequest(r.organization_id as number, r.id, reason.trim(), token);
      return t("requests.page.rejected");
    });
    closeReject();
  }

  return (
    <li className={cardClass}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-gray-900 dark:text-gray-100">{what}</p>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {t("requests.page.askedBy", { name: who })}
            {r.created_at ? ` · ${formatDate(r.created_at, { dateStyle: "medium" })}` : ""}
          </p>
          {r.note && (
            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
              {t("requests.page.note", { note: r.note })}
            </p>
          )}
        </div>
        {r.status === "pending" ? (
          <div className="flex gap-2">
            <button
              type="button"
              className={primaryButtonClass}
              disabled={busy}
              onClick={approve}
              aria-label={`${t("requests.page.approve")}: ${what}, ${who}`}
            >
              {t("requests.page.approve")}
            </button>
            <button
              type="button"
              className={secondaryButtonClass}
              disabled={busy}
              onClick={() => setRejecting(true)}
              aria-label={`${t("requests.page.reject")}: ${what}, ${who}`}
            >
              {t("requests.page.reject")}
            </button>
          </div>
        ) : (
          <StatusBadgeFor status={r.status} />
        )}
      </div>
      {r.status === "approved" && (
        <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
          {t("requests.page.approvedBy", { name: decider })}
        </p>
      )}
      {r.status === "denied" && (
        <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
          {t("requests.page.rejectedBy", { name: decider })}
          {r.decision_reason ? ` ${t("requests.reason", { reason: r.decision_reason })}` : ""}
        </p>
      )}
      {message && (
        <StatusLine isError={isError} className="mb-0 mt-2">
          {message}
        </StatusLine>
      )}
      {rejecting && (
        <Dialog
          modal={modal}
          title={t("requests.page.rejectTitle")}
          description={<p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{what}</p>}
        >
          <form onSubmit={reject} className="mt-3 flex flex-col gap-3">
            <div>
              <label htmlFor={`${ids}-reason`} className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t("requests.page.rejectReason")}
              </label>
              <textarea
                id={`${ids}-reason`}
                data-autofocus
                rows={3}
                maxLength={500}
                className={inputClass}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className={secondaryButtonClass} onClick={closeReject} disabled={busy}>
                {t("common.cancel")}
              </button>
              <button type="submit" className={destructiveButtonClass} disabled={busy}>
                {t("requests.page.rejectSubmit")}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </li>
  );
}
