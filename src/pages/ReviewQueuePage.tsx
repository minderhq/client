import { useCallback, useRef, useState } from "react";

import { EmptyState } from "../components/EmptyState";
import { InfoCallout } from "../components/InfoCallout";
import { PageHeader } from "../components/PageHeader";
import { Skeleton } from "../components/Skeleton";
import { StatusLine } from "../components/StatusLine";
import { SubmissionReviewCard } from "../components/SubmissionReviewCard";
import { apiFetch } from "../lib/api";
import { useAsyncResource } from "../lib/useAsyncResource";
import { useAuth } from "../lib/auth";
import {
  REVIEW_QUEUE_PAGE_SIZE,
  REVIEW_STATUS_FILTERS,
  submissionStatusLabel,
  type ReviewQueueResponse,
  type ReviewStatusFilter,
} from "../lib/submissionReview";
import { cardClass, inputClass, mutedTextClass, secondaryButtonClass } from "../lib/ui";

/** The response tagged with the filter it was fetched for, so a filter
 * change never shows the previous status's cards while the new list loads. */
interface QueueResult {
  filter: ReviewStatusFilter;
  response: ReviewQueueResponse;
}

function LoadingCards() {
  return (
    <div aria-hidden="true">
      {[0, 1].map((i) => (
        <div key={i} className={`mb-4 ${cardClass}`}>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-2 block h-4 w-72" />
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function emptyMessage(filter: ReviewStatusFilter): string {
  return filter === "submitted"
    ? "No submissions are waiting for review."
    : `No submissions with the status "${submissionStatusLabel(filter)}".`;
}

export function ReviewQueuePage() {
  const { token, sessionKey, role, isAuthenticated } = useAuth();
  const isAdmin = role === "admin";
  const [statusFilter, setStatusFilter] = useState<ReviewStatusFilter>("submitted");
  const [notice, setNotice] = useState("");
  // Focus target after a successful action: the acted-on card usually leaves
  // the list, and focus must not fall back to <body>.
  const statusRef = useRef<HTMLDivElement>(null);
  const { data, error, loading, reload } = useAsyncResource<QueueResult>(
    (signal) =>
      apiFetch<ReviewQueueResponse>(
        `/v1/marketplace/submissions?status=${encodeURIComponent(statusFilter)}&limit=${REVIEW_QUEUE_PAGE_SIZE}`,
        { token, signal },
      ).then((response) => ({ filter: statusFilter, response })),
    { deps: [statusFilter, sessionKey], enabled: isAdmin },
  );

  const handleActionDone = useCallback(
    (message: string) => {
      setNotice(message);
      reload();
      requestAnimationFrame(() => statusRef.current?.focus());
    },
    [reload],
  );

  if (!isAuthenticated || !isAdmin) {
    return (
      <>
        <PageHeader icon="review" title="Submission review" />
        <InfoCallout icon="lock">
          Admins only — log in with an admin account to review plugin
          submissions.
        </InfoCallout>
      </>
    );
  }

  const current = data?.filter === statusFilter ? data.response : null;
  const submissions = current?.plugins ?? [];
  const total = current?.total ?? submissions.length;

  return (
    <>
      <PageHeader
        icon="review"
        title="Submission review"
        subtitle="Developer-submitted plugins waiting on admin review. Oldest first."
      />

      <div className="mb-4 flex items-center gap-2">
        <label htmlFor="review-status-filter" className={mutedTextClass}>
          Status
        </label>
        <select
          id="review-status-filter"
          className={`${inputClass} max-w-xs`}
          value={statusFilter}
          onChange={(e) => {
            setNotice("");
            setStatusFilter(e.target.value as ReviewStatusFilter);
          }}
        >
          {REVIEW_STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {submissionStatusLabel(s)}
            </option>
          ))}
        </select>
      </div>

      {/* Programmatically focusable (not in the tab order) so focus can land
          on the action's result message. */}
      <div ref={statusRef} tabIndex={-1} className="outline-none">
        <StatusLine>{notice || (loading && !error ? "Loading submissions…" : "")}</StatusLine>
      </div>

      {error && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <StatusLine isError className="!mb-0">
            Couldn't load submissions: {error}
          </StatusLine>
          <button type="button" onClick={reload} className={secondaryButtonClass}>
            Try again
          </button>
        </div>
      )}

      {!current && loading && <LoadingCards />}

      {current && !error && submissions.length === 0 && (
        <EmptyState>{emptyMessage(statusFilter)}</EmptyState>
      )}

      {/* After a failed (re)load the last list may be out of date (an action
          may have moved a card), so it isn't shown under the error. */}
      {!error && submissions.length > 0 && (
        <>
          <p className={`mb-3 ${mutedTextClass}`}>
            {total > submissions.length
              ? `Showing ${submissions.length} of ${total} (oldest submissions first).`
              : `${submissions.length} ${submissions.length === 1 ? "submission" : "submissions"} (oldest submissions first).`}
          </p>
          {submissions.map((s) => (
            <SubmissionReviewCard key={s.id} submission={s} onActionDone={handleActionDone} />
          ))}
        </>
      )}
    </>
  );
}
