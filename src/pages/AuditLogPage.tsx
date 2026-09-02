import { useState } from "react";

import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { InfoCallout } from "../components/InfoCallout";
import { PageHeader } from "../components/PageHeader";
import { StatusLine } from "../components/StatusLine";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import {
  badgeClass,
  cardClass,
  inputClass,
  mutedTextClass,
  secondaryButtonClass,
  surfaceMutedClass,
} from "../lib/ui";
import { useAsyncResource } from "../lib/useAsyncResource";

interface AuditEntry {
  id: number;
  actor_id: number | null;
  action: string;
  target_type: string;
  target_id: string | null;
  before_state: unknown;
  after_state: unknown;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string | null;
}

interface AuditResponse {
  entries: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

const PAGE_SIZE = 50;

/** Tone an action by what it does — destructive red, grants/creates green,
 * everything else neutral — so a reviewer can scan the log for risky events. */
function actionTone(action: string): string {
  const a = action.toUpperCase();
  if (/(REMOVE|DELETE|REVOKE|DEMOTE|REJECT|DISABLE)/.test(a))
    return "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300";
  if (/(CREATE|ADD|GRANT|APPROVE|PROMOTE|ENABLE|SWITCH)/.test(a))
    return "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300";
  return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
}

function StatePeek({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-gray-950 p-2 font-mono text-[11px] leading-relaxed text-gray-100 ring-1 ring-white/5">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

/** Admin/security view of the append-only audit trail (GET /v1/audit-logs):
 * who did what, when, from where, with before/after state. Backend already
 * records every privileged mutation (role changes, org create/switch, member
 * add/remove, plugin review, …) and streams to SIEM — this makes it readable in
 * the app instead of only via the API. Admin-only. */
export function AuditLogPage() {
  const { isAuthenticated, token, role } = useAuth();
  const isAdmin = role === "admin";
  const [action, setAction] = useState("");
  const [targetType, setTargetType] = useState("");
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);
  const dAction = useDebouncedValue(action, 300);
  const dTarget = useDebouncedValue(targetType, 300);

  const res = useAsyncResource<AuditResponse>(
    (signal) => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (dAction.trim()) params.set("action", dAction.trim());
      if (dTarget.trim()) params.set("target_type", dTarget.trim());
      return apiFetch<AuditResponse>(`/v1/audit-logs?${params}`, { token, signal });
    },
    { deps: [token, offset, dAction, dTarget], enabled: isAuthenticated && isAdmin },
  );

  if (!isAuthenticated || !isAdmin) {
    return (
      <>
        <PageHeader
          icon="audit"
          title="Audit Log"
          subtitle="Who did what, when — the append-only record of privileged actions."
        />
        <InfoCallout icon="lock">
          Admins only — log in with an admin account to view the audit log.
        </InfoCallout>
      </>
    );
  }

  const data = res.data;
  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);

  return (
    <>
      <PageHeader
        icon="audit"
        title="Audit Log"
        subtitle="The append-only record of privileged actions — role changes, org & member management, plugin review, and more — with actor, time, source, and before/after state."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          className={`${inputClass} max-w-52`}
          placeholder="Filter by action (e.g. ORG_MEMBER_ADDED)"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setOffset(0);
          }}
          aria-label="Filter by action"
        />
        <input
          className={`${inputClass} max-w-44`}
          placeholder="Target type (e.g. org_member)"
          value={targetType}
          onChange={(e) => {
            setTargetType(e.target.value);
            setOffset(0);
          }}
          aria-label="Filter by target type"
        />
        <button
          type="button"
          onClick={() => res.reload()}
          disabled={res.loading}
          className={secondaryButtonClass}
        >
          <Icon name="reset" size={15} className={res.loading ? "animate-spin" : undefined} />
          Refresh
        </button>
        <span className={`ml-auto ${mutedTextClass}`}>
          {total > 0 ? `${from}–${to} of ${total}` : ""}
        </span>
      </div>

      <StatusLine isError={!!res.error}>
        {res.error ?? (res.loading && !res.data ? "Loading…" : "")}
      </StatusLine>

      {data && entries.length === 0 ? (
        <EmptyState>
          No audit entries{action || targetType ? " match these filters" : " yet"}.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map((e) => {
            const isOpen = expanded === e.id;
            const hasDetail =
              e.before_state != null ||
              e.after_state != null ||
              e.user_agent != null;
            return (
              <section key={e.id} className={`${cardClass} !p-3`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className={`${badgeClass} ${actionTone(e.action)} font-mono`}>
                    {e.action}
                  </span>
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {e.target_type}
                    {e.target_id && (
                      <span className="text-gray-400 dark:text-gray-500">
                        {" "}
                        · <code>{e.target_id}</code>
                      </span>
                    )}
                  </span>
                  <span className={`ml-auto text-xs ${mutedTextClass}`}>
                    {e.actor_id != null ? `actor #${e.actor_id}` : "system"}
                    {e.ip_address && ` · ${e.ip_address}`}
                    {e.created_at && ` · ${new Date(e.created_at).toLocaleString()}`}
                  </span>
                  {hasDetail && (
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : e.id)}
                      className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                      aria-expanded={isOpen}
                    >
                      <Icon
                        name="chevron-right"
                        size={13}
                        className={isOpen ? "rotate-90 transition" : "transition"}
                      />
                      Details
                    </button>
                  )}
                </div>
                {isOpen && hasDetail && (
                  <div className={`mt-2 grid gap-3 sm:grid-cols-2 ${surfaceMutedClass} p-3`}>
                    <StatePeek label="Before" value={e.before_state} />
                    <StatePeek label="After" value={e.after_state} />
                    {e.user_agent && (
                      <p className={`sm:col-span-2 ${mutedTextClass} break-all`}>
                        <span className="font-medium">User agent:</span> {e.user_agent}
                      </p>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            type="button"
            disabled={offset === 0 || res.loading}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            className={secondaryButtonClass}
          >
            <Icon name="chevron-right" size={15} className="rotate-180" />
            Previous
          </button>
          <span className={mutedTextClass}>
            {from}–{to} of {total}
          </span>
          <button
            type="button"
            disabled={to >= total || res.loading}
            onClick={() => setOffset(offset + PAGE_SIZE)}
            className={secondaryButtonClass}
          >
            Next
            <Icon name="chevron-right" size={15} />
          </button>
        </div>
      )}
    </>
  );
}
