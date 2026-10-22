// The typed module for the org's default model per role (#2523, ADR
// model-selection D3) plus the shared "which models may a picker offer" rules
// every model picker uses: the Defaults tab, the knowledge-base picker and the
// Ask override (D5 `data_policy`, #2525). Pages import these; none of them
// builds a `/v1/model-defaults` path itself.
//
// Shapes are hand-written from model-management's `ModelDefaultsOut` /
// `ModelDefaultsUpdate` and rag-pipeline's KB / query responses. Nothing here
// is synthesized client-side: locality is only "known local" when the backend
// says so (a plain Ollama tag, or a `remote:` id on a provider row the admin
// marked `is_local`); anything uncertain is treated as cloud, the same rule the
// backend enforces.

import { i18n, type Translator } from "../i18n";
import { ApiError, apiFetch } from "./api";
import type { Paginated } from "./api";
import { isEmbeddingModelName } from "./modelClassification";

// ---------------------------------------------------------------------------
// Role defaults
// ---------------------------------------------------------------------------

export type ModelRole = "answer" | "chat" | "extraction" | "utility";

export const MODEL_ROLES: readonly ModelRole[] = [
  "answer",
  "chat",
  "extraction",
  "utility",
];

/** GET /v1/model-defaults. `null` = no org default for that role (the
 * service falls back to its install default). */
export interface ModelDefaults {
  answer: string | null;
  chat: string | null;
  extraction: string | null;
  utility: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

/** PUT body: a role that is absent stays unchanged; `null` clears it. */
export type ModelDefaultsUpdate = Partial<Record<ModelRole, string | null>>;

export const ROLE_LABEL: Record<ModelRole, string> = {
  answer: "Answer",
  chat: "Chat",
  extraction: "Extraction",
  utility: "Utility",
};

export const ROLE_HELP: Record<ModelRole, string> = {
  answer: "Writes knowledge-base answers.",
  chat: "Chat and tools. Pick a model that supports tool calling.",
  extraction: "Graph building: entity and relation extraction. A local model is preferred.",
  utility:
    "Query rewrite and rerank. Uses the answer model when that is local, otherwise the local default, unless you pick one.",
};

export function getModelDefaults(
  token: string,
  signal?: AbortSignal,
): Promise<ModelDefaults> {
  return apiFetch<ModelDefaults>("/v1/model-defaults", { token, signal });
}

export function updateModelDefaults(
  token: string,
  body: ModelDefaultsUpdate,
): Promise<ModelDefaults> {
  return apiFetch<ModelDefaults>("/v1/model-defaults", {
    method: "PUT",
    token,
    body,
  });
}

/** Only the roles whose value changed, `""` mapped to `null` (clear). */
export function changedRoles(
  saved: Pick<ModelDefaults, ModelRole> | null,
  draft: Record<ModelRole, string>,
): ModelDefaultsUpdate {
  const out: ModelDefaultsUpdate = {};
  for (const role of MODEL_ROLES) {
    const before = saved?.[role] ?? "";
    if (draft[role] !== before) out[role] = draft[role] || null;
  }
  return out;
}

/** A readable message for a failed PUT /v1/model-defaults, per status. The
 * backend's 422 detail already names the role and the reason ("answer: local
 * model 'x' is not pulled"), so it is shown as-is. */
export function modelDefaultsErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.status) {
      case 403:
        return "Only an org owner or admin can change the default models.";
      case 422:
        return `That model can't be used: ${e.message}`;
      case 503:
        return "The local model server is unreachable, so the local models can't be checked. Try again shortly.";
    }
  }
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// The model catalog (GET /v1/models) and locality
// ---------------------------------------------------------------------------

/** One GET /v1/models entry. Remote (provider) entries have
 * `id = remote:<provider_id>:<model>`, `name = <model>` and
 * `provider = <provider name>`; they are only listed for a signed-in caller. */
export interface CatalogModel {
  id: string;
  name: string;
  type?: "local" | "remote" | (string & {});
  provider?: string;
  status?: string;
  /** Local models only, and only from servers that estimate it: the memory
   * the model needs at `num_ctx_assumed` (weights + KV cache), and whether
   * that fits the GPU. Older servers omit all three. */
  estimated_bytes?: number | null;
  num_ctx_assumed?: number | null;
  fit?: "fits" | "partial" | "too_large" | "unknown" | (string & {}) | null;
}

const KNOWN_FITS = ["fits", "partial", "too_large"] as const;
export type KnownFit = (typeof KNOWN_FITS)[number];

/** The model's GPU fit and size, or null when unknown (an `unknown` verdict,
 * a missing field from an older server, a remote model): no badge then. */
export function modelFit(
  m: CatalogModel | null | undefined,
): { fit: KnownFit; bytes: number } | null {
  const fit = KNOWN_FITS.find((f) => f === m?.fit);
  const bytes = m?.estimated_bytes;
  if (!fit || typeof bytes !== "number" || !(bytes > 0)) return null;
  return { fit, bytes };
}

/** "11.1" for 11.1 GiB, in the active locale. GiB, like the GPU sizes the
 * server compares against (a "16 GB" card is 16 GiB). */
export function formatModelGb(bytes: number, tr: Translator = i18n()): string {
  return tr.formatNumber(bytes / 1024 ** 3, { maximumFractionDigits: 1 });
}

const FIT_KEY = { fits: "fits", partial: "partial", too_large: "tooLarge" } as const;

/** "11.1 GB · Fits the GPU", or null when the fit is unknown. */
export function modelFitLabel(
  m: CatalogModel | null | undefined,
  tr: Translator = i18n(),
): string | null {
  const known = modelFit(m);
  if (!known) return null;
  return `${tr.t("models.size", { size: formatModelGb(known.bytes, tr) })} · ${tr.t(`models.fit.${FIT_KEY[known.fit]}`)}`;
}

/** ConfirmDialog options for saving a model that doesn't fit the GPU, naming
 * the RAM impact; null when no confirmation is needed. */
export function fitConfirmOptions(
  m: CatalogModel | null | undefined,
  tr: Translator = i18n(),
): { title: string; message: string; confirmLabel: string } | null {
  const known = modelFit(m);
  if (!m || !known || known.fit === "fits") return null;
  return {
    title: tr.t("models.confirm.title"),
    message: tr.t(known.fit === "too_large" ? "models.confirm.tooLarge" : "models.confirm.partial", {
      model: m.name,
      size: formatModelGb(known.bytes, tr),
    }),
    confirmLabel: tr.t("models.confirm.useAnyway"),
  };
}

/** Every GET /v1/models entry this caller can see. Pass the token: remote
 * (provider) models are only listed for a signed-in caller. */
export function listModels(
  token: string,
  signal?: AbortSignal,
): Promise<CatalogModel[]> {
  return apiFetch<Paginated<CatalogModel>>("/v1/models?limit=500", {
    token: token || undefined,
    signal,
    cache: true,
  }).then((res) => res?.items ?? []);
}

/** Ready generation models: no embedding-only models, nothing still loading. */
export function generationModels(models: readonly CatalogModel[]): CatalogModel[] {
  return models.filter(
    (m) =>
      (m.status === undefined || m.status === "ready") &&
      !isEmbeddingModelName(m.name),
  );
}

/** The value a picker stores for `m`: the full `remote:` id for a provider
 * model, the Ollama tag (`name`, identical to `id`) for a local one. */
export function pickerValue(m: CatalogModel): string {
  return isRemoteModelId(m.id) ? m.id : m.name;
}

export function isRemoteModelId(id: string): boolean {
  return id.startsWith("remote:");
}

/** The provider id of a `remote:<provider_id>:<model>` id, else null. */
export function remoteProviderId(id: string): string | null {
  if (!isRemoteModelId(id)) return null;
  const rest = id.slice("remote:".length);
  const sep = rest.indexOf(":");
  return sep > 0 ? rest.slice(0, sep) : null;
}

/** The vendor model name of a remote id (`remote:<p>:<model>` -> `<model>`),
 * else the id unchanged. */
export function modelShortName(id: string): string {
  const pid = remoteProviderId(id);
  return pid === null ? id : id.slice("remote:".length + pid.length + 1);
}

/** Provider ids the admin marked `is_local` (self-hosted compute). Only an
 * admin can list providers, so for anyone else this is empty and every remote
 * model counts as cloud -- the conservative reading the backend also uses. */
export type LocalProviderIds = ReadonlySet<string>;

export function isCloudModel(id: string, localProviders: LocalProviderIds): boolean {
  const pid = remoteProviderId(id);
  if (pid === null) return isRemoteModelId(id); // malformed remote id = cloud
  return !localProviders.has(pid);
}

/** Option text for a picker: name, provider and a Local/Cloud badge. */
export function modelOptionLabel(
  m: CatalogModel,
  localProviders: LocalProviderIds,
): string {
  const where = isCloudModel(m.id, localProviders) ? "Cloud" : "Local";
  const name = isRemoteModelId(m.id)
    ? `${m.name}${m.provider ? ` (${m.provider})` : ""}`
    : m.id;
  const fit = modelFitLabel(m);
  return `${name} · ${where}${fit ? ` · ${fit}` : ""}`;
}

/** The label of a model id for display, resolved through the catalog when
 * it's there. */
export function modelDisplayName(
  id: string,
  models: readonly CatalogModel[] | null | undefined,
): string {
  const m = models?.find((x) => x.id === id);
  if (m && isRemoteModelId(id)) return `${m.name}${m.provider ? ` (${m.provider})` : ""}`;
  return modelShortName(id);
}

// ---------------------------------------------------------------------------
// Knowledge-base data policy (#2525, ADR D5)
// ---------------------------------------------------------------------------

export type DataPolicy = "cloud_allowed" | "local_only";

export const DATA_POLICY_LABEL: Record<DataPolicy, string> = {
  cloud_allowed: "Cloud allowed",
  local_only: "Local only",
};

export const LOCAL_ONLY_MODEL_HINT =
  "This knowledge base is Local only: its content is never sent to a cloud model, so cloud models can't be picked. Use a local model or a self-hosted provider marked local.";

/** A readable message for a failed KB create/update that touched
 * `data_policy`. A 403 on loosening Local only -> Cloud allowed means the
 * caller isn't the KB owner or an org admin. */
export function dataPolicyErrorMessage(e: unknown, loosening: boolean): string | null {
  if (!(e instanceof ApiError)) return null;
  if (e.status === 403 && loosening) {
    return "Only the knowledge base owner or an org admin can switch a Local only knowledge base back to Cloud allowed.";
  }
  if (e.status === 503) {
    return "Couldn't save changes right now — nothing was changed. Try again.";
  }
  return null;
}

/** Whether the query error is rag-pipeline's local_only refusal of a cloud
 * model (403). */
export function isLocalOnlyRefusal(e: unknown): boolean {
  return (
    e instanceof ApiError && e.status === 403 && /local_only/i.test(e.message)
  );
}

// ---------------------------------------------------------------------------
// Where a query's model came from (method_details.model_source)
// ---------------------------------------------------------------------------

export type ModelSource =
  | "request"
  | "kb"
  | "org_default"
  | "install_default"
  | "answer_model"
  | (string & {});

const SOURCE_LABEL: Record<string, string> = {
  request: "your pick",
  kb: "knowledge base setting",
  org_default: "org default",
  install_default: "install default",
  answer_model: "answer model",
};

export function modelSourceLabel(source: ModelSource | null | undefined): string | null {
  if (!source) return null;
  return SOURCE_LABEL[source] ?? source.replace(/_/g, " ");
}
