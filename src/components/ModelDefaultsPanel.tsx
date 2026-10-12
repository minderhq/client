import { useId, useState } from "react";

import { InfoCallout } from "./InfoCallout";
import { StatusLine } from "./StatusLine";
import {
  MODEL_ROLES,
  ROLE_HELP,
  ROLE_LABEL,
  changedRoles,
  getModelDefaults,
  isCloudModel,
  generationModels,
  listModels,
  modelDefaultsErrorMessage,
  modelOptionLabel,
  updateModelDefaults,
  type CatalogModel,
  type LocalProviderIds,
  type ModelDefaults,
  type ModelRole,
} from "../lib/modelDefaults";
import { cardClass, fieldHintClass, inputClass, primaryButtonClass } from "../lib/ui";
import { useAsyncResource } from "../lib/useAsyncResource";

const NO_LOCAL_PROVIDERS: LocalProviderIds = new Set();

function draftFrom(d: ModelDefaults | null): Record<ModelRole, string> {
  return {
    answer: d?.answer ?? "",
    chat: d?.chat ?? "",
    extraction: d?.extraction ?? "",
    utility: d?.utility ?? "",
  };
}

/** One picker per role (#2523, ADR D3/D9). Org owners/admins edit; every
 * other member sees the same pickers read-only. Save PUTs only the roles
 * that changed, so two admins editing different roles don't overwrite each
 * other. */
export function ModelDefaultsPanel({
  token,
  canEdit,
  sessionKey,
  localProviders = NO_LOCAL_PROVIDERS,
}: {
  token: string;
  canEdit: boolean;
  /** useAuth()'s sessionKey: re-load on a new session / org only. */
  sessionKey?: string | number | null;
  localProviders?: LocalProviderIds;
}) {
  const baseId = useId();
  const defaultsRes = useAsyncResource((signal) => getModelDefaults(token, signal), {
    enabled: !!token,
    deps: [sessionKey],
  });
  const modelsRes = useAsyncResource(
    (signal) => listModels(token, signal).then(generationModels),
    { enabled: !!token, deps: [sessionKey] },
  );
  // null = untouched: the pickers follow the saved defaults until edited.
  const [draft, setDraft] = useState<Record<ModelRole, string> | null>(null);
  // The PUT response is the new saved state -- no re-fetch (and no flash of
  // the old values) needed.
  const [justSaved, setJustSaved] = useState<ModelDefaults | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);

  const saved = justSaved ?? defaultsRes.data;
  const values = draft ?? draftFrom(saved);
  const models: CatalogModel[] = modelsRes.data ?? [];
  const pending = changedRoles(saved, values);
  const dirty = Object.keys(pending).length > 0;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (saving || !canEdit || !dirty) return;
    setSaving(true);
    setIsError(false);
    setStatus("Saving…");
    try {
      setJustSaved(await updateModelDefaults(token, pending));
      setDraft(null);
      setStatus("Saved.");
    } catch (err) {
      setStatus(modelDefaultsErrorMessage(err));
      setIsError(true);
    }
    setSaving(false);
  }

  if (!token) {
    return (
      <InfoCallout icon="lock">Log in to see your organization's default models.</InfoCallout>
    );
  }

  return (
    <section className={cardClass} aria-label="Default models">
      <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
        Default models
      </h2>
      <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
        The model each task uses unless a knowledge base or a question picks
        its own. "None" uses the install default.
      </p>
      {!canEdit && (
        <div className="mb-3">
          <InfoCallout icon="lock">
            Only an org owner or admin can change the default models.
          </InfoCallout>
        </div>
      )}
      {defaultsRes.error && (
        <StatusLine isError>{defaultsRes.error}</StatusLine>
      )}
      <form onSubmit={handleSave}>
        <fieldset
          disabled={!canEdit || saving || saved === null}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          {MODEL_ROLES.map((role) => {
            const id = `${baseId}-${role}`;
            const value = values[role];
            const known = !value || models.some((m) => m.id === value);
            return (
              <div key={role}>
                <label
                  htmlFor={id}
                  className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  {ROLE_LABEL[role]}
                </label>
                <select
                  id={id}
                  className={inputClass}
                  value={value}
                  onChange={(ev) => {
                    setStatus("");
                    setDraft({ ...values, [role]: ev.target.value });
                  }}
                >
                  <option value="">None (use install default)</option>
                  {!known && (
                    <option value={value}>
                      {value} · {isCloudModel(value, localProviders) ? "Cloud" : "Local"} (not available)
                    </option>
                  )}
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {modelOptionLabel(m, localProviders)}
                    </option>
                  ))}
                </select>
                <p className={fieldHintClass}>{ROLE_HELP[role]}</p>
              </div>
            );
          })}
        </fieldset>
        {canEdit && (
          <div className="mt-3 flex items-center gap-3">
            <button
              type="submit"
              disabled={saving || !dirty}
              className={primaryButtonClass}
            >
              {saving ? "Saving…" : "Save defaults"}
            </button>
            {saved?.updated_at && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Last changed {new Date(saved.updated_at).toLocaleString()}
                {saved.updated_by ? ` by ${saved.updated_by}` : ""}
              </span>
            )}
          </div>
        )}
      </form>
      {status && (
        <StatusLine isError={isError} className="mb-0 mt-2">
          {status}
        </StatusLine>
      )}
    </section>
  );
}
