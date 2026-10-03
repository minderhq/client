import { NavLink, useLocation } from "react-router-dom";

import { useAuth } from "../lib/auth";
import { tabGroupForPath, visibleEntry } from "../lib/nav";
import { useBillingAccess } from "../lib/useBillingAccess";
import { Icon } from "./Icon";

/** In-page sub-navigation for the grouped pages (Marketplace › Discover /
 * Installed / Publish, Billing & licenses, Knowledge Graph). The old nav
 * listed every Available/Installed/Submit/… page as its own sidebar row, so
 * users couldn't tell they were facets of one thing. Now the sidebar shows one
 * entry per family and this segmented strip sits at the top of each of its
 * pages, making the relationship obvious and the sibling pages one tap away.
 * Rendered centrally by the app shell, so it appears above every grouped page
 * without each page having to opt in. Returns null off a grouped route, and
 * when the caller can see only one tab (nothing to switch between).
 *
 * Route tabs are links, not an ARIA tablist: each one loads a different URL,
 * so a labelled <nav> with aria-current="page" on the active link (NavLink
 * sets it) is the correct pattern, not role="tab" panels. */
export function PageTabs() {
  const { pathname } = useLocation();
  const { role } = useAuth();
  const billing = useBillingAccess();
  const entry = tabGroupForPath(pathname);
  const group = entry && visibleEntry(entry, { isAdmin: role === "admin", billing });
  const tabs = group?.tabs ?? [];
  if (!group || tabs.length <= 1) return null;

  return (
    <nav
      aria-label={`${group.label} sections`}
      className="mb-5 flex flex-wrap gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1 dark:border-gray-800 dark:bg-gray-900/60"
    >
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          title={tab.description}
          className={({ isActive }) =>
            `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              isActive
                ? "bg-white text-indigo-700 shadow-sm ring-1 ring-black/[0.03] dark:bg-gray-800 dark:text-indigo-200 dark:ring-white/[0.04]"
                : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
            }`
          }
        >
          <Icon name={tab.icon} size={15} />
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
