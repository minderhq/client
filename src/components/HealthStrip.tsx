import { Link } from "react-router-dom";

import { apiFetch } from "../lib/api";
import { useAsyncResource } from "../lib/useAsyncResource";
import { Icon } from "./Icon";
import { Skeleton } from "./Skeleton";

interface ServiceStatus {
  name: string;
  reachable: boolean;
  status: string;
}

interface StatusResponse {
  services: ServiceStatus[];
}

function isHealthy(s: ServiceStatus): boolean {
  return s.reachable && s.status === "healthy";
}

type Health = "ok" | "warn" | "down";

const DOT_CLASS: Record<Health, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  down: "bg-red-500",
};

/** One-line system-health summary for the home dashboard, built on the same
 * public `GET /v1/status` the full Status page uses -- so "is everything up"
 * is answered the moment you land, not three clicks deep. Deliberately quiet
 * on failure (returns null): a broken health check on the home page would
 * itself look like an outage, and the real place to investigate one already
 * exists at /platform/status. */
export function HealthStrip() {
  const services = useAsyncResource((signal) =>
    // `?? []`, not a bare `r.services`: a response that omits `services`
    // resolves this hook's `data` to `undefined`, which slips past the
    // `data === null` guards below (both stay false) and crashes on
    // `.length`/`.filter` -- exactly the outage-looking failure this
    // component exists to avoid (see the "deliberately quiet" doc above).
    apiFetch<StatusResponse>("/v1/status", { signal }).then((r) => r.services ?? []),
  );

  if (services.error) return null;
  if (services.loading && services.data === null) {
    return <Skeleton className="mb-6 h-14 w-full" />;
  }
  if (services.data === null || services.data.length === 0) return null;

  const total = services.data.length;
  const healthy = services.data.filter(isHealthy).length;
  const health: Health = healthy === total ? "ok" : healthy === 0 ? "down" : "warn";

  return (
    <Link
      to="/platform/status"
      data-health={health}
      className="group mb-6 flex items-center gap-3.5 rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-sm shadow-sm ring-1 ring-black/[0.02] transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:ring-white/[0.02] dark:hover:border-indigo-800"
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
        {health === "ok" && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        )}
        <span
          className={`relative inline-flex h-2.5 w-2.5 rounded-full ${DOT_CLASS[health]}`}
        />
      </span>
      <span className="font-medium text-gray-900 dark:text-gray-100">
        {health === "ok"
          ? "All systems healthy"
          : `${healthy}/${total} services healthy`}
      </span>
      <span className="ml-auto hidden -space-x-1 sm:flex" aria-hidden="true">
        {services.data.map((s) => (
          <span
            key={s.name}
            title={s.name}
            className={`h-2.5 w-2.5 rounded-full border-2 border-white dark:border-gray-900 ${
              isHealthy(s) ? "bg-emerald-500" : s.reachable ? "bg-amber-500" : "bg-red-500"
            }`}
          />
        ))}
      </span>
      <span className="flex items-center gap-1 whitespace-nowrap font-medium text-indigo-600 dark:text-indigo-400">
        View status
        <Icon
          name="arrow"
          size={14}
          className="transition-transform group-hover:translate-x-0.5"
        />
      </span>
    </Link>
  );
}
