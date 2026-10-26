// The one typed module for every model-provider (Cloud Providers / BYOK) call
// this client makes: list, presets, create, update (rename, rotate key,
// enable/disable, models), delete, test and fetch-models. Pages import these
// functions; none of them builds one of these `/v1/model-providers` paths
// itself.
//
// Not in the spec: the gateway forwards `/v1/model-providers/*` to
// model-management through a generic `{path}` catch-all, so the gateway spec
// (`api-types.gen.ts`) has no schemas for these bodies. The shapes are
// hand-written from model-management's `ProviderOut` / `ProviderPresetOut` /
// fetch-models response (#2522). Fields are documented as the backend returns
// them; nothing here is synthesized client-side.

import { ApiError, apiFetch, friendlyErrorMessage } from "./api";

export type ProviderAdapter = "openai_compatible" | "anthropic" | "ollama";

/** One org-owned provider row (model-management's `ProviderOut`). */
export interface Provider {
  id: string;
  adapter: ProviderAdapter;
  name: string;
  base_url: string | null;
  api_key_masked: string;
  enabled: boolean;
  is_local: boolean;
  /** #1511: whether the org admin acknowledged the privacy tradeoff of a
   * non-local (cloud/BYOK) provider. Only meaningful for `is_local === false`. */
  privacy_acknowledged: boolean;
  /** #2522: the model ids the admin chose for this row (may be empty). */
  models: string[];
  /** #2522: the ids this row actually offers -- `models` when set, else the
   * static catalog for the vendor it describes (OpenAI / Anthropic), else
   * nothing. Empty on a non-local row means no model can be used yet. */
  effective_models: string[];
  /** The adapter that actually serves this row: differs from `adapter` for an
   * `openai_compatible` row on Ollama's port (11434), served as `ollama`.
   * Absent on an older backend. */
  effective_adapter?: ProviderAdapter;
  /** Mask PII before text is sent to this provider. Ignored for `is_local`. */
  pii_masking_enabled: boolean;
  /** #2530: why this stored row breaks the CURRENT network (egress) policy,
   * e.g. its base URL points somewhere now refused; null when it's fine.
   * The row is kept, but every call through it is refused with this reason.
   * Absent on a backend older than #2548. */
  policy_error?: string | null;
  created_at: string;
  updated_at: string;
}

/** A suggested "add provider" configuration (`ProviderPresetOut`, #1585),
 * served read-only by GET /v1/model-providers/presets and rendered as the
 * add-provider dropdown. The backend is the single source of truth for the
 * list (#1467): e.g. "vLLM (self-hosted)" is just an `openai_compatible` row
 * with `is_local` pre-set, and "z.ai (GLM)" / OpenRouter (#2522) are
 * `openai_compatible` rows with a base URL hint and suggested models. */
export interface ProviderPreset {
  id: string;
  label: string;
  adapter: ProviderAdapter;
  is_local: boolean;
  base_url_placeholder: string | null;
  requires_api_key: boolean;
  description: string;
  /** #2522: model ids the add form pre-fills; the admin can edit them. */
  suggested_models: string[];
}

export interface ProviderCreate {
  adapter: ProviderAdapter;
  name: string;
  base_url?: string;
  /** Required for a cloud row; optional for an `is_local` (keyless) one. */
  api_key?: string;
  is_local: boolean;
  privacy_acknowledged: boolean;
  pii_masking_enabled?: boolean;
  models?: string[];
}

/** PATCH body: every field optional; an omitted field is left unchanged.
 * `models: []` clears the row's list. */
export interface ProviderUpdate {
  name?: string;
  api_key?: string;
  enabled?: boolean;
  privacy_acknowledged?: boolean;
  pii_masking_enabled?: boolean;
  models?: string[];
}

export interface ProviderTestResult {
  ok: boolean;
  detail: string;
  /** Whether the tested model can call tools. Absent on older servers. */
  tools?: "yes" | "no" | "unknown";
}

/** POST /v1/model-providers/{id}/fetch-models: the ids the vendor reports
 * (`source: "vendor"`) or, when the vendor can't list them, the static catalog
 * (`"catalog"`). Nothing is saved. */
export interface FetchModelsResult {
  models: string[];
  source: "vendor" | "catalog" | (string & {});
}

// Every path below is a full `/v1/...` literal (no shared prefix constant) so
// the client and core-repo route-contract tests can see and check each one.

export function listProviders(
  token: string,
  signal?: AbortSignal,
): Promise<Provider[]> {
  return apiFetch<Provider[]>("/v1/model-providers", { token, signal });
}

export function listProviderPresets(
  token: string,
  signal?: AbortSignal,
): Promise<ProviderPreset[]> {
  return apiFetch<ProviderPreset[]>("/v1/model-providers/presets", {
    token,
    signal,
  });
}

export function createProvider(
  token: string,
  body: ProviderCreate,
): Promise<Provider> {
  return apiFetch<Provider>("/v1/model-providers", { method: "POST", token, body });
}

export function updateProvider(
  token: string,
  id: string,
  body: ProviderUpdate,
): Promise<Provider> {
  return apiFetch<Provider>(`/v1/model-providers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    token,
    body,
  });
}

export function deleteProvider(token: string, id: string): Promise<void> {
  return apiFetch<void>(`/v1/model-providers/${encodeURIComponent(id)}`, {
    method: "DELETE",
    token,
  });
}

export function testProvider(
  token: string,
  id: string,
): Promise<ProviderTestResult> {
  return apiFetch<ProviderTestResult>(
    `/v1/model-providers/${encodeURIComponent(id)}/test`,
    { method: "POST", token },
  );
}

export function fetchProviderModels(
  token: string,
  id: string,
): Promise<FetchModelsResult> {
  return apiFetch<FetchModelsResult>(
    `/v1/model-providers/${encodeURIComponent(id)}/fetch-models`,
    { method: "POST", token },
  );
}

/** Whether `url`'s host is a loopback address (localhost, 127.x, ::1,
 * 0.0.0.0). The backend refuses those: inside Docker they point at the
 * container itself, not the machine running the model server. */
export function isLoopbackUrl(url: string): boolean {
  const raw = url.trim();
  if (!raw) return false;
  let host: string;
  try {
    host = new URL(raw.includes("://") ? raw : `http://${raw}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  host = host.replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    /^127\.\d+\.\d+\.\d+$/.test(host)
  );
}

// ---------------------------------------------------------------------------
// Model id validation -- mirrors the backend's rules, so a bad id is caught in
// the editor instead of coming back as a 422 on save.
// ---------------------------------------------------------------------------

export const MAX_MODEL_ID_LENGTH = 200;
export const MAX_MODELS = 200;

// Whitespace or an ASCII/C1 control character anywhere in an id.
// eslint-disable-next-line no-control-regex
const INVALID_ID_CHARS = /[\s\u0000-\u001f\u007f-\u009f]/;

/** Why `raw` (already trimmed by the caller or not) can't be added to
 * `existing`, or null when it can. */
export function modelIdError(raw: string, existing: readonly string[]): string | null {
  const id = raw.trim();
  if (!id) return "Enter a model id.";
  if (id.length > MAX_MODEL_ID_LENGTH) {
    return `A model id can be at most ${MAX_MODEL_ID_LENGTH} characters.`;
  }
  if (INVALID_ID_CHARS.test(id)) {
    return "A model id can't contain spaces or control characters.";
  }
  if (existing.includes(id)) return `"${id}" is already in the list.`;
  if (existing.length >= MAX_MODELS) {
    return `A provider can have at most ${MAX_MODELS} models.`;
  }
  return null;
}

/** `current` plus every valid id of `added` not already in it, in order,
 * capped at MAX_MODELS. Invalid ids are dropped. */
export function mergeModelIds(
  current: readonly string[],
  added: readonly string[],
): string[] {
  const out = [...current];
  for (const raw of added) {
    if (out.length >= MAX_MODELS) break;
    if (modelIdError(raw, out) === null) out.push(raw.trim());
  }
  return out;
}

/** A readable message for a failed fetch-models call, per status. The backend's
 * 502 detail is already actionable ("authentication failed — check the API
 * key", "... enter the model ids manually"), so it is shown as-is. */
export function fetchModelsErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.status) {
      case 403:
        return "You need permission to manage model providers to fetch models.";
      case 404:
        return "This provider no longer exists — reload the page.";
      case 429:
        return "Too many fetch requests — wait a moment and try again.";
      case 502:
        return e.message || "The provider returned an error — enter the model ids manually.";
      case 504:
        return "The provider didn't answer in time — try again, or enter the model ids manually.";
      case 500:
        return "The stored API key couldn't be read — rotate the key and try again.";
    }
  }
  return e instanceof Error ? e.message : String(e);
}

/** A readable message for a failed create / update / test / delete. A 422
 * carries the backend's reason as-is: a base URL the network policy refuses,
 * "self-hosted" (`is_local`) where the install doesn't allow it, a missing
 * privacy acknowledgment or an invalid model list. */
export function providerSaveErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 422) return `The provider was refused: ${e.message}`;
    if (e.status === 403) return "You need permission to manage model providers.";
  }
  return friendlyErrorMessage(e);
}
