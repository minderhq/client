import type { ReactNode } from "react";

import {
  distributionLabel,
  nonEmptyStrings,
  parseServerTimestamp,
  type ReviewSubmission,
} from "../lib/submissionReview";
import { badgeClass, sectionLabelClass, surfaceMutedClass } from "../lib/ui";
import { ExternalLink } from "./ExternalLink";

function present(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** One `<dt>`/`<dd>` pair. Callers render it only when the value exists, so a
 * missing field is absent rather than shown as "undefined" or an empty row. */
function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-gray-900 dark:text-gray-100">
        {children}
      </dd>
    </div>
  );
}

function Timestamp({ value }: { value: string }) {
  const date = parseServerTimestamp(value);
  if (!date) return <>{value}</>;
  return (
    <time dateTime={date.toISOString()} title={date.toISOString()}>
      {date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
    </time>
  );
}

const codeClass = "break-all font-mono text-[13px]";
const dlClass = "mt-2 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2";

/** Everything a reviewer needs to judge a submission: what will run, who
 * submitted it and when, the latest reviewer feedback, and the raw record.
 * Pure rendering, no requests. */
export function SubmissionDetails({
  submission,
  headingId,
}: {
  submission: ReviewSubmission;
  /** Prefix for the sub-section heading ids (unique per card). */
  headingId: string;
}) {
  const distribution = distributionLabel(submission.distribution_type);
  const services = nonEmptyStrings(submission.requires_services);
  const screenshots = nonEmptyStrings(submission.screenshots);
  const runsId = `${headingId}-runs`;
  const submissionId = `${headingId}-submission`;

  // Who submitted it and when. Built as a list so the whole section is left
  // out when the API returned none of these fields.
  const submissionRows: ReactNode[] = [];
  if (present(submission.submitted_by)) {
    submissionRows.push(
      <Detail key="submitted_by" label="Submitted by (user ID)">
        <code className={codeClass}>{submission.submitted_by}</code>
      </Detail>,
    );
  }
  if (present(submission.author)) {
    submissionRows.push(
      <Detail key="author" label="Author (as declared)">
        {submission.author}
      </Detail>,
    );
  }
  if (present(submission.pricing_model)) {
    submissionRows.push(
      <Detail key="pricing" label="Pricing">
        {capitalize(submission.pricing_model)}
        {present(submission.base_tier) && ` · ${submission.base_tier} tier`}
      </Detail>,
    );
  }
  for (const [key, label] of [
    ["created_at", "Created"],
    ["updated_at", "Last updated"],
    ["published_at", "Published"],
  ] as const) {
    const value = submission[key];
    if (present(value)) {
      submissionRows.push(
        <Detail key={key} label={label}>
          <Timestamp value={value} />
        </Detail>,
      );
    }
  }
  if (present(submission.reviewed_by)) {
    submissionRows.push(
      <Detail key="reviewed_by" label="Last reviewer (user ID)">
        <code className={codeClass}>{submission.reviewed_by}</code>
      </Detail>,
    );
  }
  if (screenshots.length > 0) {
    submissionRows.push(
      <Detail key="screenshots" label="Screenshots">
        <ul className="space-y-0.5">
          {screenshots.map((url, i) => (
            <li key={`${i}-${url}`}>
              <ExternalLink href={url}>Screenshot {i + 1}</ExternalLink>
            </li>
          ))}
        </ul>
      </Detail>,
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <section aria-labelledby={runsId}>
        <h3 id={runsId} className={sectionLabelClass}>
          What will run
        </h3>
        <dl className={dlClass}>
          {distribution && <Detail label="Distribution">{distribution}</Detail>}
          {present(submission.docker_image) && (
            <Detail label="Docker image">
              <code className={codeClass}>{submission.docker_image}</code>
            </Detail>
          )}
          {present(submission.repository_url) && (
            <Detail label="Repository">
              <ExternalLink href={submission.repository_url} />
            </Detail>
          )}
          {present(submission.current_version) && (
            <Detail label="Version">
              <code className={codeClass}>{submission.current_version}</code>
            </Detail>
          )}
          <Detail label="Required services">
            {services.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5" aria-label="Required services">
                {services.map((s, i) => (
                  <li key={`${i}-${s}`} className={badgeClass}>
                    {s}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-gray-500 dark:text-gray-400">None declared</span>
            )}
          </Detail>
        </dl>
      </section>

      {submissionRows.length > 0 && (
        <section aria-labelledby={submissionId}>
          <h3 id={submissionId} className={sectionLabelClass}>
            Submission
          </h3>
          <dl className={dlClass}>{submissionRows}</dl>
        </section>
      )}

      {present(submission.review_notes) && (
        <div className={`${surfaceMutedClass} p-3`}>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Previous reviewer feedback
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200">
            {submission.review_notes}
          </p>
        </div>
      )}

      <details className={surfaceMutedClass}>
        <summary className="cursor-pointer select-none rounded-lg px-3 py-2 text-sm font-medium text-gray-700 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/70 dark:text-gray-300">
          Full submission record (JSON)
        </summary>
        {/* Text only: JSON.stringify output rendered as a React text node, so
            nothing in the record is ever interpreted as HTML. */}
        <pre className="max-h-96 overflow-auto border-t border-gray-200 px-3 py-2 font-mono text-xs leading-relaxed text-gray-800 dark:border-gray-800 dark:text-gray-200">
          {JSON.stringify(submission, null, 2)}
        </pre>
      </details>
    </div>
  );
}
