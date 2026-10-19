import { apiFetch, type Paginated } from "./api";
import { useAuth } from "./auth";
import { type JourneyCounts, type KbReadiness, kbReady } from "./journey";
import { type AsyncResource, useAsyncResource } from "./useAsyncResource";

/** Fetches the live golden-path counts (ready-KBs + pipelines) that drive the
 * GoldenPathStepper on every Knowledge page, so no page has to reimplement the
 * "am I ready to query?" arithmetic. Owner-scoped endpoints, so it needs the
 * token; while logged out it stays idle (the stepper is about creating things).
 *
 * Both reads go through the shared read cache (#141) with the exact paths the
 * Knowledge Bases / Pipelines / Ask pages and the command palette use, so the
 * stepper shares their requests instead of sending its own.
 *
 * `refreshKey` lets a page force a re-run after it mutates state on the same
 * page (e.g. bumps when a KB or pipeline is created/deleted). Pass something
 * stable such as a count -- never an array whose identity changes on every
 * reload. The mutation itself (through apiFetch) invalidates the cached lists,
 * so the re-run reads fresh data; a re-run without one is served from cache. */
export function useJourney(refreshKey?: unknown): AsyncResource<JourneyCounts> {
  const { token, sessionKey } = useAuth();
  return useAsyncResource<JourneyCounts>(
    (signal) =>
      Promise.all([
        apiFetch<Paginated<KbReadiness>>("/v1/rag/knowledge-bases?limit=100", {
          signal,
          token,
          cache: true,
        }),
        // Only `total` is used; limit=100 matches the other pages' read so the
        // cached response is shared.
        apiFetch<Paginated<unknown>>("/v1/rag/pipeline?limit=100", {
          signal,
          token,
          cache: true,
        }),
      ]).then(([kbs, pipelines]) => ({
        kbCount: kbs.total,
        readyKbCount: kbs.items.filter(kbReady).length,
        pipelineCount: pipelines.total,
      })),
    { deps: [sessionKey, refreshKey], enabled: Boolean(token) },
  );
}
