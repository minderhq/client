import { useState } from "react";

import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { InfoCallout } from "../components/InfoCallout";
import { PageHeader } from "../components/PageHeader";
import { StatusLine } from "../components/StatusLine";
import { useConfirm } from "../components/ConfirmDialog";
import { apiFetch, friendlyErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  badgeClass,
  badgeTone,
  destructiveButtonClass,
  ghostButtonClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../lib/ui";
import { useAsyncResource } from "../lib/useAsyncResource";

// #1207 Increment 4: admin-only management of cloud/remote model provider
// credentials (openai_compatible / anthropic) -- create, enable/disable,
// delete. Renaming or rotating an existing provider's key is a smaller
// follow-up, not attempted here (delete + re-create covers that need today).
//
// #1467: a provider row can also be `is_local` -- self-hosted compute (e.g.
// vLLM) reached through the SAME openai_compatible adapter/base_url
// mechanism as a real external vendor, just flagged as free/uncapped instead
// of getting a second "local provider" concept -- see the PR description for
// the full reasoning.

export interface Provider {
  id: string;
  adapter: "openai_compatible" | "anthropic";
  name: string;
  base_url: string | null;
  api_key_masked: string;
  enabled: boolean;
  is_local: boolean;
  created_at: string;
  updated_at: string;
}

const ADAPTER_LABEL: Record<Provider["adapter"], string> = {
  openai_compatible: "OpenAI-compatible",
  anthropic: "Anthropic",
};

// A suggested "add provider" configuration, served read-only by the backend at
// GET /v1/model-providers/presets (#1585 / ProviderPresetOut) and rendered as
// the add-provider dropdown. The backend is the single source of truth for the
// list (#1467) -- notably the first-class "vLLM (self-hosted)" entry, which is
// just an `openai_compatible` row with `is_local` pre-set, so a self-hosted
// vLLM box is a labeled option rather than something the user must know to
// hand-build as a generic openai_compatible row. Static, credential-free
// metadata -- see the backend's core.provider_catalog for the field semantics.
export interface ProviderPreset {
  id: string;
  label: string;
  adapter: Provider["adapter"];
  is_local: boolean;
  base_url_placeholder: string | null;
  requires_api_key: boolean;
  description: string;
}

function ProviderRow({
  provider,
  token,
  onChanged,
  confirm,
}: {
  provider: Provider;
  token: string;
  onChanged: () => void;
  confirm: ReturnType<typeof useConfirm>["confirm"];
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);

  async function handleToggle() {
    if (busy) return; // already in flight -- ignore a double-click/tap
    setBusy(true);
    setIsError(false);
    setStatus("");
    try {
      await apiFetch(`/v1/model-providers/${encodeURIComponent(provider.id)}`, {
        method: "PATCH",
        token,
        body: { enabled: !provider.enabled },
      });
      onChanged();
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    }
    setBusy(false);
  }

  async function handleTest() {
    if (busy) return; // already in flight -- ignore a double-click/tap
    setBusy(true);
    setIsError(false);
    setStatus("Testing…");
    try {
      const result = await apiFetch<{ ok: boolean; detail: string }>(
        `/v1/model-providers/${encodeURIComponent(provider.id)}/test`,
        { method: "POST", token },
      );
      setStatus(result.detail);
      setIsError(!result.ok);
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    }
    setBusy(false);
  }

  async function handleDelete() {
    if (
      !(await confirm({
        title: "Delete provider",
        message: `Remove "${provider.name}"? Any model routed through it will stop working immediately.`,
        confirmLabel: "Delete",
        danger: true,
      }))
    ) {
      return;
    }
    if (busy) return;
    setBusy(true);
    setIsError(false);
    setStatus("");
    try {
      await apiFetch(`/v1/model-providers/${encodeURIComponent(provider.id)}`, {
        method: "DELETE",
        token,
      });
      onChanged();
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    }
    setBusy(false);
  }

  return (
    <div className="mb-2 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-gray-900 dark:text-gray-100">
          {provider.name}
        </span>
        <span className={badgeClass}>{ADAPTER_LABEL[provider.adapter]}</span>
        {provider.is_local && <span className={badgeClass}>self-hosted</span>}
        <span
          className={`${badgeClass} ${provider.enabled ? badgeTone.success : badgeTone.warn}`}
        >
          {provider.enabled ? "enabled" : "disabled"}
        </span>
        {provider.base_url && (
          <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
            {provider.base_url}
          </span>
        )}
        <span className="font-mono text-xs text-gray-400 dark:text-gray-500">
          {provider.api_key_masked}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={handleTest} disabled={busy} className={secondaryButtonClass}>
            Test
          </button>
          <button onClick={handleToggle} disabled={busy} className={ghostButtonClass}>
            {provider.enabled ? "Disable" : "Enable"}
          </button>
          <button onClick={handleDelete} disabled={busy} className={destructiveButtonClass}>
            <Icon name="delete" size={14} /> Delete
          </button>
        </div>
      </div>
      {status && (
        <StatusLine isError={isError} className="mb-0 mt-2">
          {status}
        </StatusLine>
      )}
    </div>
  );
}

function AddProviderForm({
  token,
  onCreated,
  presets,
  presetsLoading,
  presetsError,
}: {
  token: string;
  onCreated: () => void;
  presets: ProviderPreset[] | null;
  presetsLoading: boolean;
  presetsError: string | null;
}) {
  const [open, setOpen] = useState(false);
  // The chosen preset's `id`, or null to fall back to the first preset (so the
  // dropdown shows a sensible default the moment the backend list loads, with
  // no effect needed to seed state). A stale id (preset list changed under us)
  // also falls back to the first entry rather than leaving nothing selected.
  const [presetId, setPresetId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);

  const selected =
    presets?.find((p) => p.id === presetId) ?? presets?.[0] ?? null;

  function reset() {
    setPresetId(null);
    setName("");
    setBaseUrl("");
    setApiKey("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !selected) return;
    setBusy(true);
    setIsError(false);
    setStatus("Adding…");
    try {
      await apiFetch("/v1/model-providers", {
        method: "POST",
        token,
        body: {
          adapter: selected.adapter,
          name,
          base_url: baseUrl || undefined,
          api_key: apiKey,
          is_local: selected.is_local,
        },
      });
      reset();
      setOpen(false);
      setStatus("");
      onCreated();
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    }
    setBusy(false);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className={primaryButtonClass}>
        <Icon name="plus" size={15} /> Add Provider
      </button>
    );
  }

  // A self-hosted preset (vLLM) has no vendor default base_url, so it's genuinely
  // required; hosted presets can leave it blank to use the adapter's own API.
  const baseUrlHelp = selected?.is_local
    ? "your server's OpenAI-compatible endpoint"
    : selected?.base_url_placeholder
      ? "optional — a custom OpenAI-compatible endpoint"
      : "optional — defaults to the provider's own API";
  // The create endpoint still requires a non-empty api_key even when the preset
  // doesn't need a real one (a self-hosted vLLM run without --api-key accepts any
  // bearer token), so the field stays required -- `requires_api_key` only drives
  // the hint that any placeholder value will do.
  const apiKeyHelp = selected && !selected.requires_api_key
    ? "not required by default — any non-empty value works unless the server was started with an API key"
    : "";

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-4 flex flex-col gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700"
    >
      {selected ? (
        <>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Provider type
            </label>
            <select
              className={inputClass}
              value={selected.id}
              onChange={(e) => setPresetId(e.target.value)}
            >
              {presets?.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            {selected.description && (
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                {selected.description}
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Name
            </label>
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`e.g. ${selected.label}`}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Base URL <span className="font-normal text-gray-400">({baseUrlHelp})</span>
            </label>
            <input
              className={inputClass}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={selected.base_url_placeholder ?? ""}
              required={selected.is_local}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              API key
              {apiKeyHelp && (
                <span className="ml-1 font-normal text-gray-400">({apiKeyHelp})</span>
              )}
            </label>
            <input
              type="password"
              className={inputClass}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={selected.requires_api_key ? "" : "not-required"}
              required
            />
          </div>
        </>
      ) : presetsLoading ? (
        <StatusLine className="mb-0">Loading provider presets…</StatusLine>
      ) : (
        <StatusLine isError className="mb-0">
          {presetsError ?? "No provider presets are available."}
        </StatusLine>
      )}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy || !selected} className={primaryButtonClass}>
          {busy ? "Adding…" : "Add"}
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
            setStatus("");
          }}
          disabled={busy}
          className={secondaryButtonClass}
        >
          Cancel
        </button>
      </div>
      {status && (
        <StatusLine isError={isError} className="mb-0">
          {status}
        </StatusLine>
      )}
    </form>
  );
}

export function CloudProvidersPage() {
  const { token, role } = useAuth();
  const isAdmin = role === "admin";
  const { confirm, dialog } = useConfirm();

  const providersRes = useAsyncResource(
    (signal) => apiFetch<Provider[]>("/v1/model-providers", { token, signal }),
    { enabled: isAdmin },
  );

  // The add-provider dropdown is backend-driven (#1467/#1585): the preset list
  // -- including the first-class "vLLM (self-hosted)" entry -- comes from
  // GET /v1/model-providers/presets rather than being hardcoded here, so a new
  // preset ships without a client change. Admin-only, like the endpoint itself.
  const presetsRes = useAsyncResource(
    (signal) =>
      apiFetch<ProviderPreset[]>("/v1/model-providers/presets", { token, signal }),
    { enabled: isAdmin },
  );

  return (
    <>
      {dialog}
      <PageHeader
        icon="globe"
        title="Cloud Providers"
        subtitle="Connect an external OpenAI-compatible/Anthropic provider or a self-hosted instance (e.g. vLLM) so models from it appear alongside your local Ollama models. Opt-in and per-organization — nothing here is on by default. Admin-only: this manages the org's own API credentials."
      />

      {!isAdmin && (
        <InfoCallout icon="lock">
          {token
            ? "Admin role required to view or manage cloud providers."
            : "Log in as an admin to view or manage cloud providers."}
        </InfoCallout>
      )}

      {isAdmin && (
        <>
          <div className="mb-4">
            <AddProviderForm
              token={token}
              onCreated={providersRes.reload}
              presets={presetsRes.data}
              presetsLoading={presetsRes.loading}
              presetsError={presetsRes.error}
            />
          </div>

          <StatusLine isError={!!providersRes.error}>
            {providersRes.error ?? (providersRes.loading ? "Loading…" : "")}
          </StatusLine>
          {providersRes.data?.length === 0 && (
            <EmptyState>No cloud providers configured yet.</EmptyState>
          )}
          {providersRes.data?.map((p) => (
            <ProviderRow
              key={p.id}
              provider={p}
              token={token}
              onChanged={providersRes.reload}
              confirm={confirm}
            />
          ))}
        </>
      )}
    </>
  );
}
