// Shapes and pure helpers for Publish › Submission review (#2194): the admin
// queue served by `GET /v1/marketplace/submissions` and its reviewer actions
// (`POST /v1/marketplace/submissions/{id}/{claim,approve,reject,archive}`).
//
// The queue returns the marketplace's `PluginResponse` rows. Nothing here is
// synthesized client-side: a field the API doesn't return is not shown.

import type { CatalogPlugin, PluginStatus } from "./marketplace";

/** One row of the review queue. Everything but the identity and the status is
 * optional, so a row from an older backend (or a legacy row with NULL columns)
 * renders without "undefined" or a crash. */
export type ReviewSubmission = Pick<CatalogPlugin, "id" | "name" | "display_name"> &
  Partial<Omit<CatalogPlugin, "id" | "name" | "display_name" | "status">> & {
    /** Typed open: an unknown status from a newer backend still renders. */
    status: PluginStatus | (string & {});
    /** #402 review metadata. `submitted_by` / `reviewed_by` are opaque JWT
     * `sub` ids, not display names. */
    submitted_by?: string | null;
    reviewed_by?: string | null;
    /** The notes from the most recent transition that carried notes (a
     * reject). The full transition history isn't exposed by the API. */
    review_notes?: string | null;
  };

export interface ReviewQueueResponse {
  plugins: ReviewSubmission[];
  /** Total rows in this status (the page may hold fewer). */
  total?: number;
  count?: number;
}

/** The backend's maximum page size for the queue (`le=100`). */
export const REVIEW_QUEUE_PAGE_SIZE = 100;

/** The statuses a reviewer can filter on, in review order. The legacy
 * `pending` status is deliberately absent: the #402 state machine never
 * produces it. A legacy row that still carries it is shown with
 * {@link submissionStatusLabel} if it ever comes back. */
export const REVIEW_STATUS_FILTERS = [
  "submitted",
  "in_review",
  "approved",
  "rejected",
  "archived",
  "draft",
] as const satisfies readonly PluginStatus[];

export type ReviewStatusFilter = (typeof REVIEW_STATUS_FILTERS)[number];

const STATUS_LABELS: Record<PluginStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  in_review: "In review",
  approved: "Approved",
  rejected: "Rejected",
  archived: "Archived",
  // Defensive only: the queue endpoint filters on `origin = 'submitted'`,
  // pre-#402 rows took the column default `origin = 'first_party'`, and this
  // client no longer asks for `status=pending`. So the queue can't return a
  // pending row today; the label is kept so a stray one still reads right.
  pending: "Pending (legacy)",
};

/** Sentence-case label for a status, including the legacy `pending` and any
 * status this client doesn't know yet (shown as-is, underscores spaced). */
export function submissionStatusLabel(status: string): string {
  if (Object.hasOwn(STATUS_LABELS, status)) {
    return STATUS_LABELS[status as PluginStatus];
  }
  const spaced = status.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export type ReviewerAction = "claim" | "approve" | "reject" | "archive";

/** The reviewer actions available from a status. Mirrors the backend state
 * machine's ALLOWED_TRANSITIONS (core/review.py), reviewer side only: the
 * developer's own submit action isn't offered here. `pending` keeps its legacy
 * transitions so an old row can still be resolved. */
export function reviewerActionsFor(status: string): ReviewerAction[] {
  switch (status) {
    case "submitted":
      return ["claim", "reject"];
    case "in_review":
      return ["approve", "reject"];
    case "approved":
      return ["archive"];
    case "pending":
      // Defensive only (see STATUS_LABELS): the queue can't return a pending
      // row today. These are the backend's legacy transitions for it.
      return ["approve", "reject", "archive"];
    default:
      return []; // draft, rejected, archived, or unknown
  }
}

/** Why a status offers the actions it does, shown as visible text next to the
 * action buttons so the reason isn't hidden in a tooltip. */
export function reviewerActionHint(status: string): string {
  switch (status) {
    case "submitted":
      return "Claim this submission to start reviewing it. Approve becomes available once it's in review.";
    case "in_review":
      return "Approve to publish it in the catalog, or reject it with feedback for the developer.";
    case "approved":
      return "Approved and listed in the catalog. Archive it to remove it from the catalog.";
    case "pending":
      return "This listing predates the review workflow. Approve, reject or archive it to resolve it.";
    case "draft":
      return "No reviewer action yet: the developer hasn't submitted this draft.";
    case "rejected":
      return "No reviewer action: waiting for the developer to address the feedback and resubmit.";
    case "archived":
      return "No reviewer action: archived is a final status.";
    default:
      return "No reviewer action is available in this status.";
  }
}

export function distributionLabel(type: string | null | undefined): string | null {
  switch (type) {
    case "git":
      return "Git repository";
    case "docker":
      return "Docker image";
    case "hybrid":
      return "Hybrid (Git and Docker)";
    case null:
    case undefined:
    case "":
      return null;
    default:
      return type;
  }
}

/** A list field that may be missing, null, or (from a misbehaving writer)
 * hold non-string or blank entries. */
export function nonEmptyStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

function quoted(submission: ReviewSubmission): string {
  return `"${submission.display_name}" (${submission.name})`;
}

/** The approve dialog's message: what approving publishes and what will run,
 * so the reviewer confirms with the image and required services in view. */
export function approveConfirmMessage(submission: ReviewSubmission): string {
  const parts = [
    `Approving publishes ${quoted(submission)} in the catalog, where anyone on this installation can install it.`,
  ];
  const image = submission.docker_image?.trim();
  const distribution = submission.distribution_type;
  if (image) {
    parts.push(`It runs the Docker image ${image}.`);
  } else if (distribution === "docker" || distribution === "hybrid") {
    parts.push("It doesn't declare a Docker image.");
  }
  const repository = submission.repository_url?.trim();
  if (repository) {
    parts.push(`Source repository: ${repository}.`);
  }
  const services = nonEmptyStrings(submission.requires_services);
  parts.push(
    services.length > 0
      ? `It requires these services: ${services.join(", ")}.`
      : "It doesn't declare any required services.",
  );
  return parts.join(" ");
}

export function archiveConfirmMessage(submission: ReviewSubmission): string {
  return (
    `Archiving removes ${quoted(submission)} from the catalog. ` +
    "Archived is a final status: it can't be approved again from here."
  );
}

/** Parse a backend timestamp. The marketplace stores naive UTC `TIMESTAMP`
 * columns, so the API returns ISO strings without an offset; `new Date()`
 * would read those as local time. Treat an offset-less value as UTC. */
export function parseServerTimestamp(value: string | null | undefined): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim());
  const date = new Date(hasOffset ? value.trim() : `${value.trim()}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
