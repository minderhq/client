import { useCallback, useState } from "react";

import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { InfoCallout } from "../components/InfoCallout";
import { PageHeader } from "../components/PageHeader";
import { StatusLine } from "../components/StatusLine";
import { apiFetch, friendlyErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  badgeClass,
  badgeTone,
  cardClass,
  secondaryButtonClass,
} from "../lib/ui";
import { useAsyncResource } from "../lib/useAsyncResource";

interface ServiceStatus {
  name: string;
  reachable: boolean;
  status: string;
  version?: string | null;
  environment?: string | null;
  checks?: Record<string, string>;
  error?: string;
}

interface StatusResponse {
  services: ServiceStatus[];
}

interface LogLine {
  stream: "stdout" | "stderr";
  text: string;
}

interface LogsResponse {
  name: string;
  lines: LogLine[];
}

function statusBadgeColor(status: string): string {
  if (status === "healthy") return badgeTone.success;
  if (status === "degraded") return badgeTone.warn;
  return badgeTone.danger;
}

function dotColor(service: ServiceStatus): string {
  if (service.reachable && service.status === "healthy") return "bg-emerald-500";
  if (service.reachable) return "bg-amber-500";
  return "bg-red-500";
}

export function LogViewer({ name, token }: { name: string; token: string }) {
  const [loaded, setLoaded] = useState(false);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [status, setStatus] = useState("");

  const loadLogs = useCallback(async () => {
    setStatus("Loading…");
    try {
      const res = await apiFetch<LogsResponse>(
        `/v1/containers/${encodeURIComponent(name)}/logs?tail=200`,
        { token },
      );
      setLines(res.lines);
      setLoaded(true);
      setStatus("");
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
    }
  }, [name, token]);

  function handleToggle(e: React.SyntheticEvent<HTMLDetailsElement>) {
    // Only fires the fetch on first expand -- once `loaded`, logs sat frozen
    // at whatever "tail=200" caught at that moment, with re-opening the
    // details element a no-op. The explicit Refresh button below is the only
    // way to see anything newer.
    if (!e.currentTarget.open || loaded) return;
    loadLogs();
  }

  return (
    <details className="group mt-3" onToggle={handleToggle}>
      <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400">
        <Icon name="chevron-right" size={13} className="transition group-open:rotate-90" />
        {token ? "View recent logs" : "View recent logs (log in required)"}
      </summary>
      <div className="mt-2 text-xs">
        <div className="mb-1 flex items-center gap-2">
          {status && <p className="text-gray-500 dark:text-gray-400">{status}</p>}
          {loaded && (
            <button
              onClick={loadLogs}
              className="flex items-center gap-1 text-indigo-600 hover:underline dark:text-indigo-400"
            >
              <Icon name="reset" size={12} /> Refresh
            </button>
          )}
        </div>
        {lines.length > 0 && (
          <pre className="max-h-64 overflow-auto rounded-lg bg-gray-950 p-3 font-mono text-[11px] leading-relaxed text-gray-100 ring-1 ring-white/5">
            {lines.map((l, i) => (
              <div key={i} className={l.stream === "stderr" ? "text-red-400" : "text-gray-100"}>
                {l.text.replace(/\n$/, "")}
              </div>
            ))}
          </pre>
        )}
        {loaded && lines.length === 0 && (
          <p className="text-gray-500 dark:text-gray-400">No recent log output.</p>
        )}
      </div>
    </details>
  );
}

function ServiceCard({ service, token }: { service: ServiceStatus; token: string }) {
  return (
    <section className={`mb-3 ${cardClass} !p-4`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotColor(service)}`} aria-hidden="true" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {service.name}
        </h3>
        <span className={`${badgeClass} ${statusBadgeColor(service.status)}`}>
          {service.status}
        </span>
        {service.version && <span className={badgeClass}>reported v{service.version}</span>}
      </div>
      {service.error && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
          <Icon name="warning" size={13} />
          {service.error}
        </p>
      )}
      {service.checks && Object.keys(service.checks).length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          {Object.entries(service.checks).map(([dep, result]) => (
            <li key={dep} className={badgeClass}>
              {dep}: {result}
            </li>
          ))}
        </ul>
      )}
      <LogViewer name={service.name} token={token} />
    </section>
  );
}

export function StatusPage() {
  const { token } = useAuth();
  // Single whole-object read → useAsyncResource (cancels on unmount, drops a
  // stale response if Refresh is clicked twice fast). #502
  const services = useAsyncResource((signal) =>
    apiFetch<StatusResponse>("/v1/status", { signal }).then((r) => r.services ?? []),
  );

  const data = services.data;
  const total = data?.length ?? 0;
  const healthy =
    data?.filter((s) => s.reachable && s.status === "healthy").length ?? 0;

  return (
    <>
      <PageHeader
        icon="status"
        title="Status"
        subtitle="Health, reported version, and recent logs for every core service. Browsing the health grid is open for everyone; log in to view logs (they can contain stack traces, so they're treated as sensitive)."
        actions={
          <button
            onClick={services.reload}
            disabled={services.loading}
            className={secondaryButtonClass}
          >
            <Icon
              name="reset"
              size={16}
              className={services.loading ? "animate-spin" : undefined}
            />
            Refresh
          </button>
        }
      />

      {total > 0 && (
        <div className={`mb-4 flex items-center gap-3 ${cardClass} !py-3`}>
          <span className="relative flex h-2.5 w-2.5">
            {healthy === total && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            )}
            <span
              className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                healthy === total ? "bg-emerald-500" : healthy === 0 ? "bg-red-500" : "bg-amber-500"
              }`}
            />
          </span>
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {healthy === total
              ? `All ${total} services healthy`
              : `${healthy} of ${total} services healthy`}
          </span>
        </div>
      )}

      <div className="mb-4">
        <InfoCallout icon="info">
          "Reported version" is a hardcoded string each service's own code
          carries — it isn't derived from the deployed Docker image tag, so
          don't treat it as a deployment-tracking signal.
        </InfoCallout>
      </div>

      <StatusLine isError={!!services.error}>
        {services.error ?? (services.loading ? "Loading…" : "")}
      </StatusLine>

      {data?.length === 0 && (
        <EmptyState>No services reported by the server.</EmptyState>
      )}
      {data?.map((s) => (
        <ServiceCard key={s.name} service={s} token={token} />
      ))}
    </>
  );
}
