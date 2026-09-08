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

// A preset is a client-side convenience over the two real backend adapters
// (schema.sql's own "vendor convenience is a client-side preset dropdown,
// not a backend provider type") -- vLLM is just an openai_compatible row
// with `is_local` pre-set, same as z.ai/OpenRouter/Together are
// openai_compatible rows differing only by base_url.
type Preset = "openai_compatible" | "vllm" | "anthropic";

const PRESET_OPTIONS: { value: Preset; label: string }[] = [
  {
    value: "openai_compatible",
    label: "OpenAI-compatible (OpenAI, z.ai, OpenRouter, Together, Azure OpenAI, …)",
  },
  { value: "vllm", label: "vLLM (self-hosted)" },
  { value: "anthropic", label: "Anthropic" },
];

const PRESET_CONFIG: Record<
  Preset,
  {
    adapter: Provider["adapter"];
    isLocal: boolean;
    baseUrlPlaceholder: string;
    baseUrlHelp: string;
    apiKeyPlaceholder: string;
    apiKeyHelp: string;
  }
> = {
  openai_compatible: {
    adapter: "openai_compatible",
    isLocal: false,
    baseUrlPlaceholder: "https://api.z.ai/api/paas/v4",
    baseUrlHelp: "optional — defaults to the adapter's own API",
    apiKeyPlaceholder: "",
    apiKeyHelp: "",
  },
  vllm: {
    adapter: "openai_compatible",
    isLocal: true,
    baseUrlPlaceholder: "http://<your-vllm-host>:8000/v1",
    baseUrlHelp: "your vLLM server's OpenAI-compatible endpoint",
    apiKeyPlaceholder: "not-required",
    apiKeyHelp:
      "vLLM doesn't require a key by default — any non-empty value works unless you started it with --api-key",
  },
  anthropic: {
    adapter: "anthropic",
    isLocal: false,
    baseUrlPlaceholder: "",
    baseUrlHelp: "optional — defaults to the adapter's own API",
    apiKeyPlaceholder: "",
    apiKeyHelp: "",
  },
};

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
}: {
  token: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<Preset>("openai_compatible");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);

  const config = PRESET_CONFIG[preset];

  function reset() {
    setPreset("openai_compatible");
    setName("");
    setBaseUrl("");
    setApiKey("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setIsError(false);
    setStatus("Adding…");
    try {
      await apiFetch("/v1/model-providers", {
        method: "POST",
        token,
        body: {
          adapter: config.adapter,
          name,
          base_url: baseUrl || undefined,
          api_key: apiKey,
          is_local: config.isLocal,
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

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-4 flex flex-col gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700"
    >
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          Provider type
        </label>
        <select
          className={inputClass}
          value={preset}
          onChange={(e) => setPreset(e.target.value as Preset)}
        >
          {PRESET_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          Name
        </label>
        <input
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={
            preset === "vllm" ? "e.g. vLLM (local)" : "e.g. OpenAI (production)"
          }
          required
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          Base URL <span className="font-normal text-gray-400">({config.baseUrlHelp})</span>
        </label>
        <input
          className={inputClass}
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={config.baseUrlPlaceholder}
          required={preset === "vllm"}
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          API key
          {config.apiKeyHelp && (
            <span className="ml-1 font-normal text-gray-400">({config.apiKeyHelp})</span>
          )}
        </label>
        <input
          type="password"
          className={inputClass}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={config.apiKeyPlaceholder}
          required
        />
      </div>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy} className={primaryButtonClass}>
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
            <AddProviderForm token={token} onCreated={providersRes.reload} />
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
