import { apiFetch, type Paginated } from "./api";
import { useAuth } from "./auth";
import { type JourneyCounts, type KbReadiness, kbReady } from "./journey";
import { type AsyncResource, useAsyncResource } from "./useAsyncResource";

/** Fetches the live golden-path counts (ready-KBs + pipelines) that drive the
 * GoldenPathStepper on every Knowledge page, so no page has to reimplement the
 * "am I ready to query?" arithmetic. Owner-scoped endpoints, so it needs the
 * token; while logged out it stays idle (the stepper is about creating things).
 *
 * `refreshKey` lets a page force a re-fetch after it mutates state on the same
 * page (e.g. bumps when a KB or pipeline is created/deleted) — otherwise the
 * counts are as of mount, which is enough for the cross-page hand-off this
 * feature is really about. */
export function useJourney(refreshKey?: unknown): AsyncResource<JourneyCounts> {
  const { token } = useAuth();
  return useAsyncResource<JourneyCounts>(
    (signal) =>
      Promise.all([
        apiFetch<Paginated<KbReadiness>>("/v1/rag/knowledge-bases?limit=100", {
          signal,
          token,
        }),
        // limit=1: we only want the `total`, not the rows.
        apiFetch<Paginated<unknown>>("/v1/rag/pipeline?limit=1", { signal, token }),
      ]).then(([kbs, pipelines]) => ({
        kbCount: kbs.total,
        readyKbCount: kbs.items.filter(kbReady).length,
        pipelineCount: pipelines.total,
      })),
    { deps: [token, refreshKey], enabled: Boolean(token) },
  );
}
