import { useCallback, useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";

import { Icon } from "../components/Icon";
import { PluginLogo } from "../components/PluginLogo";
import { useConfirm } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { InfoCallout } from "../components/InfoCallout";
import { PageHeader } from "../components/PageHeader";
import { StatusLine } from "../components/StatusLine";
import { apiFetch, friendlyErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useAutoClearTimeout } from "../lib/browser";
import type { Installation } from "../lib/types";
import { usePluginLifecycle } from "../lib/usePluginLifecycle";
import {
  badgeClass,
  cardClass,
  destructiveButtonClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../lib/ui";

interface MyInstallationsResponse {
  installations: Installation[];
  count: number;
}

interface ConfigField {
  key: string;
  type?: "string" | "int" | "float" | "bool";
  secret?: boolean;
  description?: string;
  // presentation hints (SDK plugin-driven UI) — all optional, safe fallbacks
  widget?: string;
  options?: { value: unknown; label: string }[];
  options_action?: string;
  rows?: number;
  placeholder?: string;
  group?: string;
}

interface PluginDisplay {
  label?: string;
  summary?: string;
  logo?: string;
  color?: string;
  category?: string;
}

interface PluginRequires {
  services: string[];
  optional_services: string[];
  bundles: string[];
}

interface PluginConfigResponse {
  configurable: boolean;
  schema: ConfigField[];
  values: Record<string, unknown>;
  // client-facing surface added by the registry (#1264): branding + what the
  // plugin needs from the platform.
  display?: PluginDisplay | null;
  requires?: PluginRequires | null;
  capabilities?: string[];
}

function hasRequires(r: PluginRequires | null | undefined): boolean {
  return (
    !!r &&
    (r.services.length > 0 ||
      r.optional_services.length > 0 ||
      r.bundles.length > 0)
  );
}

function ReqBadge({ label }: { label: string }) {
  return (
    <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[11px] text-gray-700 dark:bg-gray-700 dark:text-gray-300">
      {label}
    </span>
  );
}

/** Resolve which widget to render: an explicit `widget` hint wins, otherwise
 * infer from `secret`/`type`. Unknown widgets fall back to a text input (the SDK
 * contract's graceful-degradation rule). */
function resolveWidget(field: ConfigField): string {
  if (field.secret) return "secret";
  if (field.widget) return field.widget;
  if (field.type === "bool") return "toggle";
  if (field.type === "int" || field.type === "float") return "number";
  return "text";
}

function FieldInput({
  id,
  field,
  value,
  onChange,
}: {
  id: string;
  field: ConfigField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const widget = resolveWidget(field);

  if (widget === "toggle") {
    return (
      <input
        id={id}
        className="h-4 w-4 rounded border-gray-300"
        type="checkbox"
        checked={!!value}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }
  if (widget === "secret") {
    return (
      <input
        id={id}
        className={inputClass}
        type="password"
        placeholder="unchanged (leave blank to keep current value)"
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (widget === "number") {
    return (
      <input
        id={id}
        className={inputClass}
        type="number"
        step={field.type === "float" ? "any" : undefined}
        defaultValue={value as number | string}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (widget === "textarea") {
    return (
      <textarea
        id={id}
        className={inputClass}
        rows={field.rows ?? 3}
        placeholder={field.placeholder}
        defaultValue={value as string}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if ((widget === "select" || widget === "multiselect") && field.options) {
    return (
      <select
        id={id}
        className={inputClass}
        defaultValue={value as string}
        onChange={(e) => onChange(e.target.value)}
      >
        {field.options.map((opt) => (
          <option key={String(opt.value)} value={String(opt.value)}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }
  // text / autocomplete / unknown → a plain text input (graceful fallback).
  return (
    <input
      id={id}
      className={inputClass}
      type="text"
      placeholder={field.placeholder}
      defaultValue={value as string}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Lazily fetches this plugin's config schema on first expand -- merged in
 * from the old standalone "Plugin Configuration" page, which made a user
 * pick the same plugin twice (once to install it here, once to find it
 * again in a completely separate page to configure it). "configurable"
 * here isn't guaranteed by "installed": plugin-registry's config schema
 * and marketplace's installation record are two independent systems linked
 * only by a name match, so a plugin can be installed with no schema, or
 * (for first-party plugins that just run regardless of any per-user
 * install) have a schema without ever appearing as "installed" for a given
 * user -- this panel only ever claims the former case, honestly. */
export function ConfigurePanel({ name, token }: { name: string; token: string }) {
  const baseId = useId();
  const [loaded, setLoaded] = useState(false);
  const [configurable, setConfigurable] = useState(false);
  const [schema, setSchema] = useState<ConfigField[]>([]);
  const [display, setDisplay] = useState<PluginDisplay | null>(null);
  const [requires, setRequires] = useState<PluginRequires | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const scheduleTimeout = useAutoClearTimeout();

  async function handleToggle(e: React.SyntheticEvent<HTMLDetailsElement>) {
    if (!e.currentTarget.open || loaded) return;
    setStatus("Loading…");
    setIsError(false);
    try {
      const cfg = await apiFetch<PluginConfigResponse>(
        `/v1/plugins/${encodeURIComponent(name)}/config`,
        { token },
      );
      setConfigurable(cfg.configurable);
      setSchema(cfg.schema);
      setDisplay(cfg.display ?? null);
      setRequires(cfg.requires ?? null);
      setValues(cfg.values);
      setLoaded(true);
      setStatus("");
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    const skipped: string[] = [];
    for (const field of schema) {
      if (!(field.key in draft)) continue;
      const raw = draft[field.key];
      if (field.secret && raw === "") continue; // unchanged
      if (field.type === "int" || field.type === "float") {
        const parsed = field.type === "int" ? parseInt(String(raw), 10) : parseFloat(String(raw));
        // An emptied/invalid number field used to serialize as `null` here
        // (JSON.stringify(NaN) === "null") and save silently -- clearing a
        // field by accident wiped the stored value with no warning. Treat
        // it as "no change" instead, same as an untouched secret field.
        if (Number.isNaN(parsed)) {
          skipped.push(field.key);
          continue;
        }
        body[field.key] = parsed;
      } else {
        body[field.key] = raw;
      }
    }
    setStatus("Saving…");
    setIsError(false);
    try {
      await apiFetch(`/v1/plugins/${encodeURIComponent(name)}/config`, {
        method: "PUT",
        body,
        token,
      });
      setStatus(
        skipped.length > 0
          ? `Saved (left ${skipped.join(", ")} unchanged — not a valid number).`
          : "Saved.",
      );
      scheduleTimeout(() => setStatus(""), skipped.length > 0 ? 4000 : 2000);
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    }
  }

  return (
    <details className="group mt-3 border-t border-gray-100 pt-3 dark:border-gray-800" onToggle={handleToggle}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-indigo-600 dark:text-indigo-400">
        <Icon name="chevron-right" size={14} className="shrink-0 transition group-open:rotate-90" />
        <Icon name="settings" size={15} className="shrink-0" />
        Configure
      </summary>
      <div className="mt-3">
        {loaded && (display || hasRequires(requires)) && (
          <div className="mb-3 rounded-md border border-gray-100 bg-gray-50 p-2 dark:border-gray-800 dark:bg-gray-900/40">
            {display && (
              <div className="flex items-center gap-2">
                <PluginLogo logo={display.logo} color={display.color} size={16} />
                <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                  {display.label ?? name}
                </span>
                {display.category && (
                  <span className="text-xs text-gray-400">{display.category}</span>
                )}
              </div>
            )}
            {hasRequires(requires) && requires && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Needs:
                </span>
                {requires.services.map((s) => (
                  <ReqBadge key={`s-${s}`} label={s} />
                ))}
                {requires.optional_services.map((s) => (
                  <ReqBadge key={`o-${s}`} label={`${s} (optional)`} />
                ))}
                {requires.bundles.map((b) => (
                  <ReqBadge key={`b-${b}`} label={`bundle: ${b}`} />
                ))}
              </div>
            )}
          </div>
        )}
        {status && <StatusLine isError={isError} className="mb-2">{status}</StatusLine>}
        {loaded && !configurable && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            This plugin has no configurable settings.
          </p>
        )}
        {loaded && configurable && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            {schema.map((field) => (
              <div key={field.key}>
                <label
                  htmlFor={`${baseId}-${field.key}`}
                  className="mb-1 block text-sm font-medium capitalize text-gray-700 dark:text-gray-300"
                >
                  {field.key}
                </label>
                <FieldInput
                  id={`${baseId}-${field.key}`}
                  field={field}
                  value={values[field.key]}
                  onChange={(v) => setDraft((d) => ({ ...d, [field.key]: v }))}
                />
                {field.description && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {field.description}
                  </p>
                )}
              </div>
            ))}
            <div>
              <button type="submit" className={primaryButtonClass}>
                Save
              </button>
            </div>
          </form>
        )}
      </div>
    </details>
  );
}

export function InstalledPluginCard({
  installation,
  token,
  onUninstalled,
  onToggleEnabled,
  confirm,
}: {
  installation: Installation;
  token: string;
  onUninstalled: (pluginId: string) => void;
  onToggleEnabled: (pluginId: string, enabled: boolean) => void;
  confirm: ReturnType<typeof useConfirm>["confirm"];
}) {
  const { status, isError, busy, uninstall, toggleEnabled } = usePluginLifecycle({
    pluginId: installation.plugin_id,
    displayName: installation.display_name,
    token,
    confirm,
    onUninstalled,
    onToggleEnabled,
  });

  async function handleUninstall() {
    await uninstall();
  }

  async function handleToggle() {
    await toggleEnabled(installation.enabled);
  }

  return (
    <section className={`mb-4 ${cardClass}`}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
          <Icon name="plugins" size={16} className="shrink-0 text-indigo-500 dark:text-indigo-400" /> {installation.display_name}
          <span className={badgeClass}>
            {installation.enabled ? "✓ enabled" : "disabled"}
          </span>
        </h2>
        <div className="flex flex-shrink-0 items-center gap-2">
          <button onClick={handleToggle} disabled={busy} className={secondaryButtonClass}>
            {installation.enabled ? "Disable" : "Enable"}
          </button>
          <button onClick={handleUninstall} disabled={busy} className={destructiveButtonClass}>
            <Icon name="delete" size={15} /> Uninstall
          </button>
        </div>
      </div>
      {installation.requires_services.length > 0 && (
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          Needs: {installation.requires_services.join(", ")}
        </p>
      )}
      {status && <StatusLine isError={isError} className="mt-2">{status}</StatusLine>}
      <ConfigurePanel name={installation.name} token={token} />
    </section>
  );
}

export function InstalledPluginsPage() {
  const { token, isAuthenticated } = useAuth();
  const { confirm, dialog } = useConfirm();
  const [installations, setInstallations] = useState<Installation[] | null>(null);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);

  const setStatusMsg = useCallback((msg: string, err = false) => {
    setStatus(msg);
    setIsError(err);
  }, []);

  const loadInstallations = useCallback(async () => {
    if (!isAuthenticated) return;
    setStatusMsg("Loading…");
    try {
      const res = await apiFetch<MyInstallationsResponse>(
        "/v1/marketplace/installations/me",
        { token },
      );
      setInstallations(res.installations ?? []);
      setStatusMsg("");
    } catch (e) {
      setStatusMsg(friendlyErrorMessage(e), true);
    }
  }, [isAuthenticated, token, setStatusMsg]);

  useEffect(() => {
    loadInstallations();
  }, [loadInstallations]);

  function handleUninstalled(pluginId: string) {
    setInstallations((prev) => (prev ?? []).filter((i) => i.plugin_id !== pluginId));
  }

  function handleToggleEnabled(pluginId: string, enabled: boolean) {
    setInstallations((prev) =>
      (prev ?? []).map((i) => (i.plugin_id === pluginId ? { ...i, enabled } : i)),
    );
  }

  return (
    <>
      {dialog}
      <PageHeader
        icon="plugins"
        title="Installed Plugins"
        subtitle="Manage the plugins you've installed — enable, disable, uninstall, or edit their settings. Requires login: installs are per-user."
      />
      <StatusLine isError={isError}>{status}</StatusLine>
      {!isAuthenticated && (
        <InfoCallout icon="lock">
          Log in (top right) to see your installed plugins.
        </InfoCallout>
      )}
      {isAuthenticated && installations !== null && installations.length === 0 && (
        <EmptyState>
          No plugins installed yet —{" "}
          <Link to="/plugins/available" className="underline hover:text-indigo-600 dark:hover:text-indigo-400">
            browse Available Plugins
          </Link>
          .
        </EmptyState>
      )}
      {isAuthenticated && installations !== null && installations.length > 0 && (
        <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
          Some of these expose AI tools the assistant can call —{" "}
          <Link to="/ai-tools/available" className="underline hover:text-indigo-600 dark:hover:text-indigo-400">
            check AI Tools
          </Link>{" "}
          to see which are live right now.
        </p>
      )}
      {installations?.map((i) => (
        <InstalledPluginCard
          key={i.plugin_id}
          installation={i}
          token={token}
          onUninstalled={handleUninstalled}
          onToggleEnabled={handleToggleEnabled}
          confirm={confirm}
        />
      ))}
    </>
  );
}
