import { useCallback, useState } from "react";

import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { InfoCallout } from "../components/InfoCallout";
import { PageHeader } from "../components/PageHeader";
import { StatusLine } from "../components/StatusLine";
import { friendlyErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  type CandidateSameAs,
  type CandidateListResponse,
  detectCandidates,
  fetchCandidates,
  reviewCandidate,
} from "../lib/graphCandidates";
import {
  badgeClass,
  cardClass,
  destructiveButtonClass,
  mutedTextClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../lib/ui";
import { useAsyncResource } from "../lib/useAsyncResource";

function CandidateCard({
  candidate,
  onChanged,
}: {
  candidate: CandidateSameAs;
  onChanged: () => void;
}) {
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);

  async function runAction(decision: "approve" | "reject") {
    setBusy(true);
    setStatus("Working…");
    setIsError(false);
    try {
      const res = await reviewCandidate(candidate.id, decision, token);
      // Dual-control: a single approval leaves it pending — say so instead of
      // implying it merged. A reject or the second approval resolves it and it
      // drops off the pending list on reload.
      if (res.status === "pending") {
        setStatus("Your approval is recorded — still needs the other owner.");
        setIsError(false);
      }
      onChanged();
    } catch (err) {
      setStatus(friendlyErrorMessage(err));
      setIsError(true);
      setBusy(false);
    }
  }

  const approvals = candidate.approvals ?? [];

  return (
    <section className={`mb-4 ${cardClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold text-gray-900 dark:text-gray-100">
            <Icon name="merge" size={16} className="shrink-0 text-indigo-500 dark:text-indigo-400" />
            <span>{candidate.entity_a}</span>
            <span className={mutedTextClass}>↔</span>
            <span>{candidate.entity_b}</span>
            {candidate.label && <span className={mutedTextClass}>({candidate.label})</span>}
          </h3>
          <p className={`mt-1 ${mutedTextClass}`}>
            Owners: {candidate.owner_a ?? "—"} · {candidate.owner_b ?? "—"}
          </p>
          {candidate.evidence && (
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {candidate.evidence}
            </p>
          )}
          <p className={`mt-1 ${mutedTextClass}`}>
            {approvals.length} of 2 approvals
            {approvals.length > 0 ? ` · ${approvals.join(", ")}` : ""}
          </p>
        </div>
        {typeof candidate.confidence === "number" && (
          <span className={`${badgeClass} bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 flex-shrink-0`}>
            {Math.round(candidate.confidence * 100)}% similar
          </span>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <button disabled={busy} onClick={() => runAction("approve")} className={primaryButtonClass}>
          Approve merge
        </button>
        <button disabled={busy} onClick={() => runAction("reject")} className={destructiveButtonClass}>
          Reject
        </button>
      </div>

      <StatusLine isError={isError}>{status}</StatusLine>
    </section>
  );
}

/** #1215: the cross-tenant SAME_AS candidate review surface — the last part of
 * the dual-control entity-dedup workflow (#1125) that had no UI. Any owning
 * tenant sees candidates they're a party to and can approve/reject; a real
 * SAME_AS link is written only once BOTH owners approve. A platform operator
 * additionally sees every candidate and can trigger the cross-tenant scan. */
export function EntityMergeReviewPage() {
  const { token, isAuthenticated, isPlatformAdmin } = useAuth();
  const [detecting, setDetecting] = useState(false);
  const [detectStatus, setDetectStatus] = useState("");
  const [detectError, setDetectError] = useState(false);

  const queue = useAsyncResource<CandidateListResponse>(
    (signal) => fetchCandidates(token, signal),
    { enabled: isAuthenticated },
  );

  const handleChanged = useCallback(() => queue.reload(), [queue]);

  async function handleDetect() {
    setDetecting(true);
    setDetectStatus("Scanning for cross-org entity matches…");
    setDetectError(false);
    try {
      const res = await detectCandidates(token);
      setDetectStatus(
        res.candidates > 0
          ? `Found ${res.candidates} new candidate${res.candidates === 1 ? "" : "s"}.`
          : "No new candidates found.",
      );
      queue.reload();
    } catch (err) {
      setDetectStatus(friendlyErrorMessage(err));
      setDetectError(true);
    } finally {
      setDetecting(false);
    }
  }

  if (!isAuthenticated) {
    return (
      <>
        <PageHeader icon="merge" title="Entity Merge Review" />
        <InfoCallout icon="lock">
          Log in to review cross-organization entity-merge candidates.
        </InfoCallout>
      </>
    );
  }

  const candidates = queue.data?.candidates ?? [];

  return (
    <>
      <PageHeader
        icon="merge"
        title="Entity Merge Review"
        subtitle={
          <>
            When the graph finds the same entity (a person, company, or concept)
            owned by two different organizations, it proposes a merge here rather
            than linking them automatically. A real link is written only once
            <strong> both owners approve</strong> — so no organization's data is
            joined to another's without its own consent.
          </>
        }
        actions={
          isPlatformAdmin ? (
            <button
              type="button"
              onClick={handleDetect}
              disabled={detecting}
              className={secondaryButtonClass}
            >
              <Icon name="search" size={16} />
              {detecting ? "Scanning…" : "Detect candidates"}
            </button>
          ) : undefined
        }
      />

      {detectStatus && (
        <StatusLine isError={detectError} className="mb-2">
          {detectStatus}
        </StatusLine>
      )}

      <StatusLine isError={!!queue.error}>
        {queue.error ?? (queue.loading ? "Loading…" : "")}
      </StatusLine>

      {!queue.loading && candidates.length === 0 ? (
        <EmptyState>
          No pending entity-merge candidates.
          {isPlatformAdmin
            ? " Run a scan to look for cross-organization matches."
            : ""}
        </EmptyState>
      ) : (
        candidates.map((c) => (
          <CandidateCard key={c.id} candidate={c} onChanged={handleChanged} />
        ))
      )}
    </>
  );
}
