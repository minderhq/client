import { apiFetch } from "./api";
import { useAuth } from "./auth";
import { type AsyncResource, useAsyncResource } from "./useAsyncResource";

/** One check of the gateway's readiness endpoint. `reason` is null when ready,
 * else a stable code (`no_model`, `model_service_unavailable`, `not_authorized`, …). */
export interface ReadinessCheck {
  ready: boolean;
  reason: string | null;
}

/** `GET /v1/readiness`: whether the caller's organization can be used end to
 * end yet. Typed by hand: the synced OpenAPI snapshot doesn't carry the route
 * yet (see apiContract.test.ts KNOWN_MISSING). */
export interface Readiness {
  ready: boolean;
  checks: {
    model: ReadinessCheck;
    pipeline: ReadinessCheck;
    knowledge_base: ReadinessCheck;
    email: ReadinessCheck;
  };
}

/** Public guide for connecting Ollama, vLLM or a cloud provider. */
export const MODEL_PROVIDERS_DOCS_URL = "https://minderhq.github.io/docs/model-providers/";

/** The caller's readiness, shared through the read cache so Home and the
 * GoldenPathStepper send one request. Idle while logged out (the endpoint
 * needs a workspace token). */
export function useReadiness(): AsyncResource<Readiness> {
  const { token, sessionKey } = useAuth();
  return useAsyncResource<Readiness>(
    (signal) => apiFetch<Readiness>("/v1/readiness", { signal, token, cache: true }),
    { deps: [sessionKey], enabled: Boolean(token) },
  );
}
