import { useId, useState } from "react";

import { filterByText } from "../lib/filterByText";
import {
  MAX_MODELS,
  mergeModelIds,
  modelIdError,
} from "../lib/modelProviders";
import {
  badgeClass,
  fieldHintClass,
  ghostButtonClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../lib/ui";
import { Icon } from "./Icon";

// #2522: the per-provider model list editor -- a chip/tag input. Enter (or a
// comma) adds the typed id(s), each chip has its own remove button, and
// Backspace in an empty input removes the last chip. Ids are validated with the
// backend's rules (modelIdError) so a bad id is rejected here, not as a 422.

export function ModelsEditor({
  models,
  onChange,
  disabled = false,
}: {
  models: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const inputId = useId();

  function addDraft() {
    const parts = draft
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) {
      setError(modelIdError("", models) ?? "");
      return;
    }
    let next = models;
    for (const part of parts) {
      const problem = modelIdError(part, next);
      if (problem) {
        setError(problem);
        // Keep what was valid so far and leave the rejected text to fix.
        if (next !== models) onChange(next);
        setDraft(parts.slice(parts.indexOf(part)).join(", "));
        return;
      }
      next = [...next, part];
    }
    onChange(next);
    setDraft("");
    setError("");
  }

  function remove(id: string) {
    onChange(models.filter((m) => m !== id));
  }

  return (
    <div>
      <label
        htmlFor={inputId}
        className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
      >
        Models{" "}
        <span className="font-normal text-gray-400">
          ({models.length} / {MAX_MODELS})
        </span>
      </label>
      {models.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Selected models">
          {models.map((id) => (
            <li key={id} className={`${badgeClass} font-mono`}>
              {id}
              <button
                type="button"
                onClick={() => remove(id)}
                disabled={disabled}
                aria-label={`Remove model ${id}`}
                className="rounded-full p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700"
              >
                <Icon name="close" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          id={inputId}
          className={inputClass}
          value={draft}
          disabled={disabled}
          placeholder="Add a model id, e.g. glm-4.6 — press Enter"
          aria-label="Add model id"
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault(); // never submit the surrounding form
              addDraft();
            } else if (e.key === "Backspace" && !draft && models.length > 0) {
              remove(models[models.length - 1]);
            }
          }}
        />
        <button
          type="button"
          onClick={addDraft}
          disabled={disabled || !draft.trim()}
          className={`${secondaryButtonClass} shrink-0`}
        >
          Add model
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : (
        <p className={fieldHintClass}>
          The model ids this provider offers. Only these can be used in chat
          and pipelines.
        </p>
      )}
    </div>
  );
}

// #2522: the result of "Fetch models" as a selectable list. Ids already in the
// editor show checked and locked; the admin ticks the others to add. A search
// box narrows long vendor lists (OpenRouter returns hundreds), and Select all /
// None act on the visible (filtered) ids. Nothing is saved here -- "Add
// selected" only merges into the editor; the row's Save sends the PATCH.
export function FetchedModelsPicker({
  fetched,
  current,
  source,
  onAdd,
  onClose,
}: {
  fetched: string[];
  current: string[];
  source: string;
  onAdd: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const visible = filterByText(fetched, query, (id) => [id]);
  const addable = visible.filter((id) => !current.includes(id));

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function setVisible(on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of addable) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  const chosen = fetched.filter((id) => selected.has(id) && !current.includes(id));

  return (
    <div className="mt-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-gray-700 dark:text-gray-300">
          {fetched.length} model{fetched.length === 1 ? "" : "s"} found
        </span>
        {source === "catalog" && (
          <span className="text-xs text-gray-400">
            (from the built-in catalog — the provider didn't list its models)
          </span>
        )}
      </div>
      {fetched.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          The provider returned no models — enter the model ids manually.
        </p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {fetched.length > 8 && (
              <input
                className={`${inputClass} max-w-xs`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter models"
                aria-label="Filter fetched models"
              />
            )}
            <button
              type="button"
              onClick={() => setVisible(true)}
              disabled={addable.length === 0}
              className={ghostButtonClass}
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => setVisible(false)}
              className={ghostButtonClass}
            >
              Select none
            </button>
          </div>
          <ul
            className="max-h-60 overflow-y-auto"
            aria-label="Fetched models"
          >
            {visible.map((id) => {
              const already = current.includes(id);
              return (
                <li key={id}>
                  <label className="flex items-center gap-2 py-0.5 font-mono text-sm text-gray-800 dark:text-gray-200">
                    <input
                      type="checkbox"
                      checked={already || selected.has(id)}
                      disabled={already}
                      onChange={(e) => toggle(id, e.target.checked)}
                    />
                    {id}
                    {already && (
                      <span className="font-sans text-xs text-gray-400">added</span>
                    )}
                  </label>
                </li>
              );
            })}
            {visible.length === 0 && (
              <li className="text-sm text-gray-500 dark:text-gray-400">
                No model matches “{query}”.
              </li>
            )}
          </ul>
        </>
      )}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onAdd(mergeModelIds(current, chosen))}
          disabled={chosen.length === 0}
          className={primaryButtonClass}
        >
          Add selected ({chosen.length})
        </button>
        <button type="button" onClick={onClose} className={secondaryButtonClass}>
          Close
        </button>
      </div>
    </div>
  );
}
