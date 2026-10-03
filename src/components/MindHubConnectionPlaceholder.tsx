import { useId } from "react";

import { badgeClass, cardClass, mutedTextClass } from "../lib/ui";
import { Icon } from "./Icon";

/** Where the MindHub connection will live (#2201, Phase 1 of epic #2192).
 *
 * Deliberately informational only: no button, field or link that looks like it
 * connects anything. The connection, its entitlement state and the grace
 * countdown need backend work that hasn't shipped (#2030, #2031), and a
 * control that does nothing would be a lie to the operator. When #2201 lands,
 * the real connection panel replaces this component. */
export function MindHubConnectionPlaceholder() {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={`mb-6 ${cardClass}`}>
      <div className="flex items-start justify-between gap-3">
        <h2
          id={headingId}
          className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100"
        >
          <Icon name="globe" size={16} className="shrink-0 text-indigo-500 dark:text-indigo-400" />
          MindHub connection
        </h2>
        <span className={`shrink-0 ${badgeClass}`}>Not available yet</span>
      </div>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        This installation isn't connected to MindHub, and connecting isn't
        possible in this version. Everything in Discover comes from this
        installation today.
      </p>
      <p className={`mt-3 ${mutedTextClass}`}>Coming here in a later release:</p>
      <ul className={`mt-1 list-disc pl-5 ${mutedTextClass}`}>
        <li>Connect this installation to MindHub.</li>
        <li>See your organization's entitlement state, including any grace period left.</li>
        <li>MindHub plugins appear in Discover, marked with their source.</li>
      </ul>
    </section>
  );
}
