import { useCallback, useMemo, useRef, useState } from "react";

import { ApiError, apiFetch, friendlyErrorMessage } from "../lib/api";
import { decodeJwtClaims } from "../lib/jwt";
import {
  fieldHintClass,
  inputClass,
  primaryButtonClass,
  surfaceMutedClass,
} from "../lib/ui";
import { EmptyState } from "./EmptyState";
import { StatusLine } from "./StatusLine";

/** One user's rating/review row, mirroring marketplace RatingResponse
 * (models/rating.py). `user_id` is the reviewer's stringified id, matched
 * against the caller's JWT `sub` to find "your" review. */
export interface PluginRating {
  id: string;
  plugin_id: string;
  user_id: string;
  rating: number;
  review_text: string | null;
  created_at: string;
  updated_at: string;
}

/** GET /v1/marketplace/plugins/{id}/ratings — the live aggregate plus the
 * individual reviews (newest first). */
export interface PluginRatingsResponse {
  plugin_id: string;
  rating_average: number | null;
  rating_count: number;
  ratings: PluginRating[];
}

const MAX_REVIEW_LENGTH = 4000;

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Read-only star row (★★★☆☆) for displaying a rating. */
function Stars({ value }: { value: number }) {
  return (
    <span aria-hidden className="text-amber-500 dark:text-amber-400">
      {"★".repeat(value)}
      <span className="text-gray-300 dark:text-gray-600">
        {"★".repeat(Math.max(0, 5 - value))}
      </span>
    </span>
  );
}

/** Interactive 1–5 star picker. Each star is a real button so it's keyboard-
 * and screen-reader-reachable; `disabled` renders the same stars inert (used
 * for the install-gated state). */
function StarInput({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Your rating">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} star${star === 1 ? "" : "s"}`}
          disabled={disabled}
          onClick={() => onChange(star)}
          className={`text-xl leading-none transition disabled:cursor-not-allowed ${
            star <= value
              ? "text-amber-500 dark:text-amber-400"
              : "text-gray-300 hover:text-amber-400 dark:text-gray-600"
          }`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

/** Plugin ratings/reviews (#1591): live aggregate + reviews list from
 * `GET .../ratings`, plus an install-gated submit/edit form that POSTs to the
 * same path (the backend upserts, so a resubmit edits the caller's own review).
 *
 * Lazy-loaded behind a <details> disclosure, matching DependencyPanel — the
 * marketplace list renders many cards, so we only fetch a plugin's reviews when
 * the user actually opens the panel. The caller passes `isInstalled` (whether
 * the current user has an installation) so we can gate the form up front rather
 * than only reacting to the server's 403; a stale gate is still caught by the
 * 403 handler on submit. */
export function PluginRatings({
  pluginId,
  token,
  isAuthenticated,
  isInstalled,
}: {
  pluginId: string;
  token: string;
  isAuthenticated: boolean;
  isInstalled: boolean;
}) {
  const myUserId = useMemo(() => decodeJwtClaims(token).userId, [token]);

  const [loaded, setLoaded] = useState(false);
  const [ratings, setRatings] = useState<PluginRating[]>([]);
  const [average, setAverage] = useState<number | null>(null);
  const [count, setCount] = useState(0);
  const [loadStatus, setLoadStatus] = useState("");
  const [loadIsError, setLoadIsError] = useState(false);

  // Draft form state. `prefilledFor` guards the one-time seed from the caller's
  // existing review so re-fetching after a submit never clobbers what they're
  // actively typing.
  const [rating, setRating] = useState(0);
  const [reviewText, setReviewText] = useState("");
  const prefilledRef = useRef(false);
  const [submitStatus, setSubmitStatus] = useState("");
  const [submitIsError, setSubmitIsError] = useState(false);
  const [gated, setGated] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadStatus("Loading…");
    setLoadIsError(false);
    try {
      const res = await apiFetch<PluginRatingsResponse>(
        `/v1/marketplace/plugins/${pluginId}/ratings`,
      );
      setRatings(res.ratings ?? []);
      setAverage(res.rating_average);
      setCount(res.rating_count);
      setLoaded(true);
      setLoadStatus("");
      // Seed the form from the caller's own review exactly once, so opening the
      // panel a second time (or refreshing after submit) doesn't overwrite an
      // in-progress edit.
      if (!prefilledRef.current && myUserId) {
        const mine = (res.ratings ?? []).find((r) => r.user_id === myUserId);
        if (mine) {
          setRating(mine.rating);
          setReviewText(mine.review_text ?? "");
        }
        prefilledRef.current = true;
      }
    } catch (e) {
      setLoadStatus(friendlyErrorMessage(e));
      setLoadIsError(true);
    }
  }, [pluginId, myUserId]);

  async function handleToggle(e: React.SyntheticEvent<HTMLDetailsElement>) {
    if (!e.currentTarget.open || loaded) return;
    await load();
  }

  const myReview = useMemo(
    () => (myUserId ? ratings.find((r) => r.user_id === myUserId) : undefined),
    [ratings, myUserId],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rating < 1 || busy) return;
    setBusy(true);
    setSubmitStatus("");
    setSubmitIsError(false);
    try {
      await apiFetch<PluginRating>(`/v1/marketplace/plugins/${pluginId}/ratings`, {
        method: "POST",
        // The reviewer is derived from the JWT server-side — we NEVER send a
        // user id from the client. Only the star count and optional text.
        body: { rating, review_text: reviewText.trim() ? reviewText.trim() : null },
        token,
      });
      setSubmitStatus(myReview ? "Review updated." : "Thanks for your review!");
      setSubmitIsError(false);
      setGated(false);
      // Refresh so the aggregate + list reflect the new/updated review. The
      // prefill guard is already set, so this won't disturb the draft.
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        // Install-gate: the server rejects a review from someone who never
        // installed the plugin. Surface it as guidance, not a raw error.
        setGated(true);
        setSubmitStatus("Install this plugin before reviewing it.");
      } else {
        setSubmitStatus(friendlyErrorMessage(e));
      }
      setSubmitIsError(true);
    } finally {
      setBusy(false);
    }
  }

  const canReview = isAuthenticated && isInstalled && !gated;

  return (
    <details className="mt-2" onToggle={handleToggle}>
      <summary className="cursor-pointer text-xs font-medium text-indigo-600 dark:text-indigo-400">
        Ratings &amp; reviews
        {count > 0 && average != null && ` · ${average.toFixed(1)}★ (${count})`}
      </summary>
      <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
        {loadStatus && <StatusLine isError={loadIsError}>{loadStatus}</StatusLine>}

        {loaded && (
          <>
            <p className="mb-2 text-sm text-gray-700 dark:text-gray-300">
              {count > 0 && average != null ? (
                <>
                  <span className="font-semibold">{average.toFixed(1)}</span>★ average
                  across {count} review{count === 1 ? "" : "s"}
                </>
              ) : (
                "No reviews yet — be the first to rate this plugin."
              )}
            </p>

            {/* Submit / edit form */}
            {isAuthenticated ? (
              <form onSubmit={handleSubmit} className={`mb-3 p-3 ${surfaceMutedClass}`}>
                <div className="flex items-center gap-2">
                  <StarInput
                    value={rating}
                    onChange={setRating}
                    disabled={!canReview}
                  />
                  {myReview && canReview && (
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      Editing your review
                    </span>
                  )}
                </div>
                <textarea
                  className={`mt-2 ${inputClass}`}
                  rows={3}
                  maxLength={MAX_REVIEW_LENGTH}
                  placeholder="Share what worked (optional)…"
                  aria-label="Your review"
                  value={reviewText}
                  onChange={(ev) => setReviewText(ev.target.value)}
                  disabled={!canReview}
                />
                <div className="mt-2 flex items-center justify-between">
                  <span className={fieldHintClass}>
                    {canReview
                      ? `${reviewText.length}/${MAX_REVIEW_LENGTH}`
                      : "Install to review"}
                  </span>
                  <button
                    type="submit"
                    className={primaryButtonClass}
                    disabled={!canReview || rating < 1 || busy}
                  >
                    {myReview ? "Update review" : "Submit review"}
                  </button>
                </div>
              </form>
            ) : (
              <p className={`mb-3 ${fieldHintClass}`}>Log in to review this plugin.</p>
            )}

            {submitStatus && (
              <StatusLine isError={submitIsError} className="mb-2">
                {submitStatus}
              </StatusLine>
            )}

            {/* Reviews list */}
            {ratings.length === 0 ? (
              <EmptyState>No written reviews yet.</EmptyState>
            ) : (
              <ul className="space-y-2">
                {ratings.map((r) => (
                  <li
                    key={r.id}
                    className={`p-2 ${surfaceMutedClass} ${
                      r.user_id === myUserId ? "ring-1 ring-indigo-300 dark:ring-indigo-700" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <Stars value={r.rating} />
                      <span className="text-[11px] text-gray-400 dark:text-gray-500">
                        {r.user_id === myUserId && (
                          <span className="mr-1 font-medium text-indigo-600 dark:text-indigo-400">
                            Your review ·
                          </span>
                        )}
                        {formatShortDate(r.updated_at)}
                      </span>
                    </div>
                    {r.review_text && (
                      <p className="mt-1 whitespace-pre-wrap text-gray-600 dark:text-gray-400">
                        {r.review_text}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </details>
  );
}
