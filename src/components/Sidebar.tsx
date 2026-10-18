import { useId } from "react";
import { Link, useLocation } from "react-router-dom";

import { useI18n } from "../i18n";
import { entryIsActive, useNav, visibleSections } from "../lib/nav";
import { sectionLabelClass } from "../lib/ui";
import { useAccess } from "../lib/useCan";
import { BrandMark } from "./BrandMark";
import { Icon } from "./Icon";
import { OrgSwitcher } from "./OrgSwitcher";

const activeItemClass =
  "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200";
const inactiveItemClass =
  "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100";

/** The platform's persistent nav — a single always-visible tree, grouped by
 * what the user is trying to DO (Knowledge / Marketplace / AI & system / Team /
 * My account, then the Organization and Platform administration sections below
 * a divider) rather than by backend service. Every row is filtered through
 * useCan: a caller sees only what they hold the permission for, and a signed-out
 * visitor sees no menu at all. Renders from the
 * shared nav model (lib/nav.ts) the ⌘K palette also uses. The repetitive
 * Available/Installed pages collapse into one entry each (their siblings are
 * in-page tabs), and every row carries a plain-language tooltip so "what does
 * this do" is answerable without clicking. */
export function Sidebar({
  open,
  onNavigate,
}: {
  open: boolean;
  onNavigate: () => void;
}) {
  const access = useAccess();
  const { pathname } = useLocation();
  const sectionIdPrefix = useId();
  const { t } = useI18n();
  const { sections } = useNav();

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-shrink-0 transform flex-col overflow-y-auto border-r border-gray-200 bg-white/80 backdrop-blur-xl transition-transform duration-200 dark:border-gray-800 dark:bg-gray-950/80 lg:static lg:translate-x-0 ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      <Link
        to="/"
        onClick={onNavigate}
        className="flex items-center gap-2.5 px-5 pb-5 pt-5 text-gray-900 dark:text-gray-100"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm shadow-indigo-600/30">
          <BrandMark size={22} />
        </span>
        <span className="flex flex-col leading-none">
          <span className="font-mono text-lg font-bold tracking-tight">Minder</span>
          <span className="mt-0.5 text-[10px] font-medium uppercase tracking-widest text-gray-400 dark:text-gray-500">
            {t("shell.tagline")}
          </span>
        </span>
      </Link>

      {/* Org switcher for small screens — the topbar one is hidden below sm, so
        without this a phone user couldn't see/switch their org (#1211). Only on
        mobile (sm:hidden); sm+ uses the topbar switcher. */}
      <div className="mb-3 px-3 sm:hidden">
        <OrgSwitcher />
      </div>

      <nav aria-label={t("shell.mainNav")} className="flex flex-1 flex-col gap-5 px-3 pb-6">
        {visibleSections(sections, access).map((section, i, shown) => {
          const { items } = section;
          // One divider above the first administration section.
          const divider = section.admin && !shown[i - 1]?.admin;
          return (
            <div
              key={section.label ?? `top-${i}`}
              role={section.label ? "group" : undefined}
              aria-labelledby={section.label ? `${sectionIdPrefix}-${i}` : undefined}
              className={divider ? "border-t border-gray-200 pt-5 dark:border-gray-800" : undefined}
            >
              {section.label && (
                <p id={`${sectionIdPrefix}-${i}`} className={`mb-1.5 px-3 ${sectionLabelClass}`}>
                  {section.label}
                </p>
              )}
              <div className="flex flex-col gap-0.5">
                {items.map((item) => {
                  const active = entryIsActive(item, pathname);
                  // aria-current="page" only when this row IS the current page.
                  // When the caller sees a tab strip for this entry, the active
                  // tab is the page and this row is its parent section, so
                  // "true" (likewise on a nested route like a repository detail).
                  const ownsPage =
                    (item.tabs?.length ?? 0) <= 1 && pathname === item.to;
                  const current = active ? (ownsPage ? "page" : "true") : undefined;
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={onNavigate}
                      title={item.description}
                      aria-current={current}
                      className={`group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                        active ? activeItemClass : inactiveItemClass
                      }`}
                    >
                      {active && (
                        <span
                          aria-hidden="true"
                          className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-indigo-500"
                        />
                      )}
                      <Icon
                        name={item.icon}
                        size={17}
                        className={
                          active
                            ? "text-indigo-600 dark:text-indigo-300"
                            : "text-gray-400 transition group-hover:text-gray-600 dark:text-gray-500 dark:group-hover:text-gray-300"
                        }
                      />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
