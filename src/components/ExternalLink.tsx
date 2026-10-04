import type { ReactNode } from "react";

import { safeExternalUrl } from "../lib/safeUrl";
import { Icon } from "./Icon";

/** A link to an API-supplied URL that opens in a new tab, rendered only when
 * the URL is http(s) without embedded credentials (see
 * {@link safeExternalUrl}). Any other value renders as plain text with a
 * visible note, so a reviewer still sees what was submitted but can't open a
 * `javascript:`, `data:` or `user@host` URL by clicking it.
 *
 * The default link text is the NORMALIZED URL the link actually opens, not
 * the raw input: raw text can hide characters the URL parser drops, so the
 * visible text and the destination could otherwise disagree.
 *
 * `rel="noopener noreferrer"` keeps the opened page from reaching back into
 * this console through `window.opener` and from receiving the console URL as
 * the referrer. */
export function ExternalLink({
  href,
  children,
  className = "break-all underline hover:text-indigo-600 dark:hover:text-indigo-400",
}: {
  href: string | null | undefined;
  /** Link text. Defaults to the URL itself. */
  children?: ReactNode;
  className?: string;
}) {
  const safe = safeExternalUrl(href);
  if (!safe) {
    if (!href || !href.trim()) return null;
    return (
      <span>
        <code className="break-all">{href}</code>{" "}
        <span className="text-xs text-amber-700 dark:text-amber-300">
          (not linked: only http and https URLs without credentials open)
        </span>
      </span>
    );
  }
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer" className={className}>
      {children ?? safe}
      <Icon name="external" size={12} className="ml-1 inline-block align-baseline" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
