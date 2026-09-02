import { useCallback, useState } from "react";

import { Icon } from "../components/Icon";
import { EmptyState } from "../components/EmptyState";
import { InfoCallout } from "../components/InfoCallout";
import { PageHeader } from "../components/PageHeader";
import { StatusLine } from "../components/StatusLine";
import { apiFetch, friendlyErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  badgeClass,
  cardClass,
  destructiveButtonClass,
  mutedTextClass,
  primaryButtonClass,
} from "../lib/ui";
import { useAsyncResource } from "../lib/useAsyncResource";

interface TaxonomyCandidate {
  id: string;
  entity: string;
  label: string;
  category: string;
  confidence: number;
  votes: number;
  model: string;
  created_at?: string;
  owner_id: string;
}

interface ReviewQueueResponse {
  success: boolean;
  candidates: TaxonomyCandidate[];
}

function CandidateCard({
  candidate,
  onChanged,
}: {
  candidate: TaxonomyCandidate;
  onChanged: () => void;
}) {
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);

  async function runAction(action: "approve" | "reject") {
    setBusy(true);
    setStatus("Working…");
    setIsError(false);
    try {
      await apiFetch(
        `/v1/graph-rag/graph/taxonomy/review-queue/${encodeURIComponent(candidate.id)}/${action}`,
        { method: "POST", token },
      );
      onChanged();
    } catch (err) {
      setStatus(friendlyErrorMessage(err));
      setIsError(true);
      setBusy(false);
    }
  }

  return (
    <section className={`mb-4 ${cardClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
            <Icon name="taxonomy" size={16} className="shrink-0 text-indigo-500 dark:text-indigo-400" /> {candidate.entity}
            <span className={mutedTextClass}>({candidate.label})</span>
          </h3>
          <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
            LLM suggests: <strong>{candidate.category}</strong>
          </p>
          <p className={`mt-1 ${mutedTextClass}`}>
            {candidate.votes}/3 votes agreed · model {candidate.model}
          </p>
        </div>
        <span className={`${badgeClass} bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 flex-shrink-0`}>
          {Math.round(candidate.confidence * 100)}% confidence
        </span>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          disabled={busy}
          onClick={() => runAction("approve")}
          className={primaryButtonClass}
        >
          Approve
        </button>
        <button
          disabled={busy}
          onClick={() => runAction("reject")}
          className={destructiveButtonClass}
        >
          Reject
        </button>
      </div>

      <StatusLine isError={isError}>{status}</StatusLine>
    </section>
  );
}

export function TaxonomyReviewPage() {
  const { token, isAuthenticated } = useAuth();

  const queue = useAsyncResource<ReviewQueueResponse>(
    (signal) =>
      apiFetch<ReviewQueueResponse>("/v1/graph-rag/graph/taxonomy/review-queue", {
        token,
        signal,
      }),
    { enabled: isAuthenticated },
  );

  const handleChanged = useCallback(() => queue.reload(), [queue]);

  if (!isAuthenticated) {
    return (
      <>
        <PageHeader icon="taxonomy" title="Taxonomy Review" />
        <InfoCallout icon="lock">
          Log in to review your knowledge graph's pending taxonomy
          classifications.
        </InfoCallout>
      </>
    );
  }

  const candidates = queue.data?.candidates ?? [];

  return (
    <>
      <PageHeader
        icon="taxonomy"
        title="Taxonomy Review"
        subtitle={
          <>
            When your knowledge graph's built-in rules can't tell what kind of
            thing an entity is more precisely than a broad type (e.g.
            "Organization"), an LLM proposes a more specific category — but only
            after 3 independent guesses agree, and never published until you
            approve it here. Rejecting one just keeps the entity at its broad
            type; it's never re-guessed.
          </>
        }
      />

      <StatusLine isError={!!queue.error}>
        {queue.error ?? (queue.loading ? "Loading…" : "")}
      </StatusLine>

      {!queue.loading && candidates.length === 0 ? (
        <EmptyState>No pending taxonomy suggestions right now.</EmptyState>
      ) : (
        candidates.map((c) => (
          <CandidateCard key={c.id} candidate={c} onChanged={handleChanged} />
        ))
      )}
    </>
  );
}
