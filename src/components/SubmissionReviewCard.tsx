import { useId, useRef, useState, type MouseEvent } from "react";

import { apiFetch, friendlyErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  approveConfirmMessage,
  archiveConfirmMessage,
  reviewerActionHint,
  reviewerActionsFor,
  submissionStatusLabel,
  type ReviewSubmission,
  type ReviewerAction,
} from "../lib/submissionReview";
import {
  badgeClass,
  cardClass,
  destructiveButtonClass,
  fieldHintClass,
  inputClass,
  mutedTextClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../lib/ui";
import { submissionStatusBadgeColor, type SubmissionStatus } from "../pages/SubmissionsPage";
import { useConfirm } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { StatusLine } from "./StatusLine";
import { SubmissionDetails } from "./SubmissionDetails";

/** Visible action text plus the plugin name for assistive tech, so a screen
 * reader's button list reads "Approve Weather Plus", not a column of identical
 * "Approve"s. The visible text starts the accessible name (WCAG 2.5.3). */
function ActionLabel({ verb, name }: { verb: string; name: string }) {
  return (
    <>
      {verb}
      <span className="sr-only"> {name}</span>
    </>
  );
}

function RejectForm({
  pluginName,
  busy,
  onConfirm,
  onCancel,
}: {
  pluginName: string;
  busy: boolean;
  /** `trigger` is the confirm button, for focus to return to on failure. */
  onConfirm: (notes: string, trigger: HTMLElement | null) => void;
  onCancel: () => void;
}) {
  const idBase = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [notes, setNotes] = useState("");
  const hasNotes = notes.trim() !== "";
  const hintId = `${idBase}-hint`;

  return (
    <form
      className="mt-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700"
      onSubmit={(e) => {
        e.preventDefault();
        if (hasNotes && !busy) onConfirm(notes.trim(), confirmRef.current);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <label
        htmlFor={`${idBase}-notes`}
        className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
      >
        Feedback for the developer (required)
      </label>
      <textarea
        id={`${idBase}-notes`}
        className={inputClass}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        required
        aria-required="true"
        aria-describedby={hintId}
        autoFocus
        placeholder="What needs to change before this can be resubmitted?"
      />
      <p id={hintId} className={fieldHintClass}>
        {hasNotes
          ? "The developer sees this feedback on their submission."
          : "Write feedback to enable Confirm reject. The developer needs it to fix and resubmit."}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          ref={confirmRef}
          type="submit"
          disabled={busy || !hasNotes}
          className={destructiveButtonClass}
        >
          <ActionLabel verb="Confirm reject" name={pluginName} />
        </button>
        <button type="button" onClick={onCancel} className={secondaryButtonClass}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const DONE_MESSAGE: Record<ReviewerAction, (name: string) => string> = {
  claim: (name) => `Claimed ${name}. It's now under "In review", where you can approve or reject it.`,
  approve: (name) => `Approved ${name}. It's now listed in the catalog.`,
  reject: (name) => `Rejected ${name}. The developer can see your feedback.`,
  archive: (name) => `Archived ${name}. It's no longer listed in the catalog.`,
};

/** One submission in Publish › Submission review: the details a reviewer
 * judges it by, and the reviewer actions its status allows. Approve and
 * archive ask for confirmation first; reject needs written feedback. */
export function SubmissionReviewCard({
  submission,
  onActionDone,
}: {
  submission: ReviewSubmission;
  /** Called after a successful action with a message for the page to
   * announce. The page reloads the queue (where this card usually
   * disappears, since its status changed) and takes focus to its status
   * line, so focus never falls back to <body>. */
  onActionDone: (message: string) => void;
}) {
  const { token } = useAuth();
  const { confirm, dialog } = useConfirm();
  const headingId = useId();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const rejectButtonRef = useRef<HTMLButtonElement>(null);
  // Synchronous re-entry guard: `busy` disables the buttons only after a
  // re-render, so a fast second click/submit could otherwise slip through.
  const inFlightRef = useRef(false);

  const name = submission.display_name;
  const actions = reviewerActionsFor(submission.status);

  /** Run one transition. On failure the error shows on the card and focus
   * returns to `trigger` (the button that started it) once it's re-enabled;
   * on success the page takes over focus (see `onActionDone`). */
  async function runAction(action: ReviewerAction, trigger: HTMLElement | null, body?: unknown) {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    setIsError(false);
    setStatus("Working…");
    try {
      await apiFetch(
        `/v1/marketplace/submissions/${encodeURIComponent(submission.id)}/${action}`,
        { method: "POST", token, body },
      );
      setRejecting(false);
      setStatus("");
      setBusy(false);
      onActionDone(DONE_MESSAGE[action](name));
    } catch (err) {
      setIsError(true);
      setStatus(friendlyErrorMessage(err));
      setBusy(false);
      // Next frame: the trigger is still disabled until this re-renders.
      requestAnimationFrame(() => {
        if (trigger?.isConnected) trigger.focus();
      });
    } finally {
      inFlightRef.current = false;
    }
  }

  /** Approve/archive: ask first; on cancel, return focus to the button that
   * opened the dialog (the dialog itself doesn't restore it). */
  async function confirmThenRun(
    action: "approve" | "archive",
    event: MouseEvent<HTMLButtonElement>,
  ) {
    const trigger = event.currentTarget;
    const ok = await confirm(
      action === "approve"
        ? {
            title: `Approve "${name}"?`,
            message: approveConfirmMessage(submission),
            confirmLabel: "Approve",
          }
        : {
            title: `Archive "${name}"?`,
            message: archiveConfirmMessage(submission),
            confirmLabel: "Archive",
            danger: true,
          },
    );
    if (!ok) {
      trigger.focus();
      return;
    }
    await runAction(action, trigger);
  }

  function closeRejectForm() {
    setRejecting(false);
    // The Reject button re-mounts once the form closes; focus it next frame.
    requestAnimationFrame(() => rejectButtonRef.current?.focus());
  }

  return (
    <section aria-labelledby={headingId} className={`mb-4 ${cardClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id={headingId}
            className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100"
          >
            <Icon name="plugins" size={16} className="shrink-0 text-indigo-500 dark:text-indigo-400" />
            {name}
          </h2>
          <p className={`mt-0.5 ${mutedTextClass}`}>
            <code className="font-mono text-[13px]">{submission.name}</code>
          </p>
          {submission.description?.trim() && (
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {submission.description}
            </p>
          )}
        </div>
        <span
          className={`${badgeClass} ${submissionStatusBadgeColor(submission.status as SubmissionStatus)} flex-shrink-0`}
        >
          <span className="sr-only">Status: </span>
          {submissionStatusLabel(submission.status)}
        </span>
      </div>

      <SubmissionDetails submission={submission} headingId={headingId} />

      <div className="mt-4 border-t border-gray-100 pt-3 dark:border-gray-800">
        <p className={mutedTextClass}>{reviewerActionHint(submission.status)}</p>

        {actions.length > 0 && !rejecting && (
          <div className="mt-2 flex flex-wrap gap-2">
            {actions.includes("claim") && (
              <button
                type="button"
                disabled={busy}
                onClick={(e) => runAction("claim", e.currentTarget)}
                className={primaryButtonClass}
              >
                <ActionLabel verb="Claim" name={name} />
              </button>
            )}
            {actions.includes("approve") && (
              <button
                type="button"
                disabled={busy}
                onClick={(e) => confirmThenRun("approve", e)}
                className={primaryButtonClass}
              >
                <ActionLabel verb="Approve" name={name} />
              </button>
            )}
            {actions.includes("reject") && (
              <button
                ref={rejectButtonRef}
                type="button"
                disabled={busy}
                onClick={() => setRejecting(true)}
                className={destructiveButtonClass}
              >
                <ActionLabel verb="Reject" name={name} />
              </button>
            )}
            {actions.includes("archive") && (
              <button
                type="button"
                disabled={busy}
                onClick={(e) => confirmThenRun("archive", e)}
                className={secondaryButtonClass}
              >
                <ActionLabel verb="Archive" name={name} />
              </button>
            )}
          </div>
        )}

        {rejecting && (
          <RejectForm
            pluginName={name}
            busy={busy}
            onCancel={closeRejectForm}
            onConfirm={(notes, trigger) => runAction("reject", trigger, { notes })}
          />
        )}

        <StatusLine isError={isError} className="mt-2 !mb-0">
          {status}
        </StatusLine>
      </div>

      {dialog}
    </section>
  );
}
