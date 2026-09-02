import { useEffect, useRef, useState } from "react";

import { useAuth } from "../lib/auth";
import { fetchMyOrgs, type MyOrg, orgRoleTone } from "../lib/orgs";
import { badgeClass } from "../lib/ui";
import { Icon } from "./Icon";

/** Topbar organization context + switcher. Answers three things at once:
 *   - WHICH org am I in right now (the button shows the active org + my role),
 *   - what OTHER orgs can I act in (the dropdown lists every org I belong to —
 *     a user can be in many, with a different role in each),
 *   - HOW do I switch (picking one re-mints the JWT via /organizations/switch,
 *     then reloads so all tenant-scoped data refetches in the new context).
 *
 * Hidden entirely for logged-out users and for tokens with no org membership
 * (pre-tenancy / orgless), so it never shows an empty control. */
export function OrgSwitcher() {
  const { isAuthenticated, token, activeTenantId, switchOrg } = useAuth();
  const [orgs, setOrgs] = useState<MyOrg[]>([]);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<number | null>(null);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isAuthenticated || !token) {
      setOrgs([]);
      return;
    }
    const ctrl = new AbortController();
    fetchMyOrgs(token, ctrl.signal)
      .then((r) => setOrgs(r.organizations))
      .catch(() => setOrgs([]));
    return () => ctrl.abort();
  }, [isAuthenticated, token]);

  // Close the menu on an outside click.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!isAuthenticated || orgs.length === 0) return null;

  const active =
    orgs.find((o) => String(o.id) === activeTenantId) ??
    orgs.find((o) => o.is_home) ??
    orgs[0];
  const canSwitch = orgs.length > 1;

  async function choose(org: MyOrg) {
    if (String(org.id) === activeTenantId) {
      setOpen(false);
      return;
    }
    setSwitching(org.id);
    setError("");
    try {
      await switchOrg(org.id);
      // Switching changes the entire tenant data context — reload so every
      // page refetches under the new active org rather than showing stale rows.
      window.location.reload();
    } catch {
      setError("Couldn't switch organization.");
      setSwitching(null);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => canSwitch && setOpen((v) => !v)}
        aria-haspopup={canSwitch ? "menu" : undefined}
        aria-expanded={canSwitch ? open : undefined}
        title={canSwitch ? "Switch organization" : active.name}
        className={`flex max-w-[13rem] items-center gap-2 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-700 shadow-sm transition dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 ${
          canSwitch
            ? "hover:border-gray-400 dark:hover:border-gray-600"
            : "cursor-default"
        }`}
      >
        <Icon name="org" size={16} className="shrink-0 text-gray-400" />
        <span className="flex min-w-0 flex-col items-start leading-tight">
          <span className="max-w-[9rem] truncate font-medium">{active.name}</span>
          <span className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
            {active.org_role}
          </span>
        </span>
        {canSwitch && (
          <Icon name="chevron-updown" size={14} className="ml-auto shrink-0 text-gray-400" />
        )}
      </button>

      {open && canSwitch && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1.5 w-72 overflow-hidden rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg ring-1 ring-black/5 animate-[pop_0.16s_cubic-bezier(0.34,1.56,0.64,1)_both] dark:border-gray-800 dark:bg-gray-900"
        >
          <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            Switch organization
          </p>
          {orgs.map((org) => {
            const isActive = String(org.id) === activeTenantId;
            return (
              <button
                key={org.id}
                type="button"
                role="menuitem"
                disabled={switching !== null}
                onClick={() => choose(org)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition disabled:opacity-60 ${
                  isActive
                    ? "bg-indigo-50 dark:bg-indigo-950/60"
                    : "hover:bg-gray-50 dark:hover:bg-gray-800/60"
                }`}
              >
                <Icon name="org" size={16} className="shrink-0 text-gray-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-gray-900 dark:text-gray-100">
                    {org.name}
                    {org.is_home && (
                      <span className="ml-1.5 text-[10px] font-normal text-gray-400">
                        home
                      </span>
                    )}
                  </span>
                  <span className={`${badgeClass} ${orgRoleTone(org.org_role)} mt-0.5`}>
                    {org.org_role}
                  </span>
                </span>
                {switching === org.id ? (
                  <Icon name="reset" size={15} className="shrink-0 animate-spin text-gray-400" />
                ) : isActive ? (
                  <Icon name="check" size={16} className="shrink-0 text-indigo-500" />
                ) : null}
              </button>
            );
          })}
          {error && (
            <p className="px-2.5 py-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}
