import { Fragment } from "react";
import { Link, useLocation } from "react-router-dom";

import { useI18n } from "../i18n";
import { navTrailForPath, useNav } from "../lib/nav";
import { Icon } from "./Icon";

const linkClass =
  "rounded hover:text-indigo-600 hover:underline dark:hover:text-indigo-400";

/** Where this page sits: Home › section › entry › tab, from the same nav
 * model as the sidebar. Rendered by the shell above every page on the menu;
 * nothing on Home, the sign-in pages or an unknown path. The last crumb is
 * the current page (text, not a link). */
export function Breadcrumbs() {
  const { pathname } = useLocation();
  const { t, messages } = useI18n();
  const { sections } = useNav();
  const trail = navTrailForPath(pathname, sections);
  if (!trail) return null;

  const { section, entry, tab } = trail;
  // The entry links to itself only when a tab follows it.
  const crumbs: { label: string; to?: string }[] = [
    { label: messages.nav.items.home.label, to: "/" },
    ...(section ? [{ label: section }] : []),
    tab ? { label: entry.label, to: entry.to } : { label: entry.label },
    ...(tab ? [{ label: tab.label }] : []),
  ];

  return (
    <nav aria-label={t("shell.breadcrumb")} className="mb-3">
      <ol className="flex flex-wrap items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          return (
            <Fragment key={`${i}-${crumb.label}`}>
              {i > 0 && (
                <li aria-hidden="true" className="text-gray-300 dark:text-gray-600">
                  <Icon name="chevron-right" size={12} />
                </li>
              )}
              <li>
                {last ? (
                  <span aria-current="page" className="font-medium text-gray-700 dark:text-gray-200">
                    {crumb.label}
                  </span>
                ) : crumb.to ? (
                  <Link to={crumb.to} className={linkClass}>
                    {crumb.label}
                  </Link>
                ) : (
                  <span>{crumb.label}</span>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
