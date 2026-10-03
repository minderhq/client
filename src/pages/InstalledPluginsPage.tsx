import { useId, useState } from "react";
import { Link } from "react-router-dom";

import { Icon } from "../components/Icon";
import { PluginLogo } from "../components/PluginLogo";
import { useConfirm } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { InfoCallout } from "../components/InfoCallout";
import { PageHeader } from "../components/PageHeader";
import { PluginVersion } from "../components/PluginVersion";
import { Skeleton } from "../components/Skeleton";
import { SourceBadge } from "../components/SourceBadge";
import { StatusLine } from "../components/StatusLine";
import { apiFetch, friendlyErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useAutoClearTimeout } from "../lib/browser";
import type { InstalledEntry } from "../lib/installedPlugins";
import { isPluginNotRunningError, type RuntimePlugin } from "../lib/marketplace";
import type { Installation } from "../lib/types";
import { useInstalledPlugins } from "../lib/useInstalledPlugins";
import { usePluginLifecycle } from "../lib/usePluginLifecycle";
import {
  badgeClass,
  badgeTone,
  cardClass,
  destructiveButtonClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../lib/ui";
import { useTokenRef } from "../lib/useTokenRef";

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

interface JsonSchemaProperty {
  type?: string;
  enum?: unknown[];
  description?: string;
}

interface JsonSchema {
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

type UiSchema = Record<
  string,
  { "ui:widget"?: string; "ui:placeholder"?: string; "ui:rows"?: number }
>;

interface PluginConfigResponse {
  configurable: boolean;
  schema: ConfigField[];
  values: Record<string, unknown>;
  // client-facing surface added by the registry (#1264): branding + what the
  // plugin needs from the platform.
  display?: PluginDisplay | null;
  requires?: PluginRequires | null;
  capabilities?: string[];
  // RFC 0001 (#1263) Increment 2: the scalable form for plugins with no flat
  // `schema` (nested/enum/conditional shapes that don't fit ConfigField).
  json_schema?: JsonSchema | null;
  ui_schema?: UiSchema | null;
}

/** Maps json_schema/ui_schema onto the existing ConfigField shape so the flat
 * schema's rendering/submission logic (FieldInput, handleSubmit's int/float
 * coercion) covers advanced plugins for free -- only used when the flat
 * `schema` list is empty (RFC 0001's back-compat: a flat CONFIG_SCHEMA always
 * compiles to json_schema too, so the flat list stays authoritative when
 * present). Nested objects/arrays have no ConfigField equivalent and are
 * skipped -- graceful degradation per the RFC, not a crash. */
function jsonSchemaToConfigFields(
  jsonSchema: JsonSchema | null | undefined,
  uiSchema: UiSchema | null | undefined,
): ConfigField[] {
  const properties = jsonSchema?.properties;
  if (!properties) return [];
  const required = new Set(jsonSchema?.required ?? []);
  const fields: ConfigField[] = [];
  for (const [key, prop] of Object.entries(properties)) {
    const hint = uiSchema?.[key];
    const type: ConfigField["type"] =
      prop.type === "integer"
        ? "int"
        : prop.type === "number"
          ? "float"
          : prop.type === "boolean"
            ? "bool"
            : undefined;
    fields.push({
      key,
      type,
      secret: hint?.["ui:widget"] === "secret",
      description: required.has(key)
        ? [prop.description, "(required)"].filter(Boolean).join(" ")
        : prop.description,
      widget: hint?.["ui:widget"] ?? (prop.enum ? "select" : undefined),
      options: prop.enum?.map((v) => ({ value: v, label: String(v) })),
      rows: hint?.["ui:rows"],
      placeholder: hint?.["ui:placeholder"],
    });
  }
  return fields;
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
 * isn't implied by being listed: plugin-registry's config schema and
 * marketplace's installation record are two independent systems linked only
 * by a name match, and plugin-registry's `GET /v1/plugins` carries no
 * "configurable" flag -- so whether a plugin has settings is only known once
 * this panel asks. Runtime-loaded plugins with no per-user install (first-party
 * plugins that just run) are listed too since #2193, keyed by the same name. */
export function ConfigurePanel({ name, token }: { name: string; token: string }) {
  const baseId = useId();
  const [loaded, setLoaded] = useState(false);
  const [configurable, setConfigurable] = useState(false);
  // plugin-registry has no in-process instance to read settings from (a
  // manifest/webhook plugin, or one that isn't loaded) -- see
  // isPluginNotRunningError. Neutral, not an error.
  const [noInstance, setNoInstance] = useState(false);
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
      setSchema(
        cfg.schema.length > 0
          ? cfg.schema
          : jsonSchemaToConfigFields(cfg.json_schema, cfg.ui_schema),
      );
      setDisplay(cfg.display ?? null);
      setRequires(cfg.requires ?? null);
      setValues(cfg.values);
      setLoaded(true);
      setStatus("");
    } catch (e) {
      if (isPluginNotRunningError(e)) {
        setNoInstance(true);
        setConfigurable(false);
        setLoaded(true);
        setStatus("");
        return;
      }
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
            {noInstance
              ? "No settings available for this plugin."
              : "This plugin has no configurable settings."}
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

const HEALTH_TONE: Record<string, string> = {
  healthy: badgeTone.success,
  degraded: badgeTone.warn,
  unhealthy: badgeTone.danger,
  error: badgeTone.danger,
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** What plugin-registry reports for this plugin on this installation: whether
 * it's enabled there, and its last health check. When the runtime list loaded
 * but doesn't include the plugin, says so -- a marketplace install record
 * doesn't load a plugin by itself (today's two-plane model, #2091). Shows
 * nothing when the runtime list couldn't be loaded. */
function RuntimeState({
  runtime,
  runtimeKnown,
}: {
  runtime: RuntimePlugin | null;
  runtimeKnown: boolean;
}) {
  if (!runtime) {
    if (!runtimeKnown) return null;
    return (
      <span
        className={badgeClass}
        title="plugin-registry doesn't have this plugin loaded, so it isn't running on this installation. A marketplace install is recorded for you, but it doesn't start the plugin on its own."
      >
        <Icon name="warning" size={12} className="shrink-0" />
        Not running on this installation
      </span>
    );
  }
  const health = runtime.health_status || "unknown";
  return (
    <>
      {runtime.status === "error" ? (
        <span className={`${badgeClass} ${badgeTone.danger}`}>
          <Icon name="warning" size={12} className="shrink-0" />
          Error on this installation
        </span>
      ) : (
        <span className={`${badgeClass} ${runtime.enabled ? badgeTone.success : ""}`}>
          <Icon name={runtime.enabled ? "check" : "close"} size={12} className="shrink-0" />
          {runtime.enabled ? "Enabled on this installation" : "Disabled on this installation"}
        </span>
      )}
      <span
        className={`${badgeClass} ${HEALTH_TONE[health] ?? ""}`}
        title={
          runtime.last_health_check
            ? `Last health check: ${formatTimestamp(runtime.last_health_check)}`
            : "No health check has run yet."
        }
      >
        <Icon name="health" size={12} className="shrink-0" />
        Health: {health}
      </span>
    </>
  );
}

/** Enable/disable/uninstall for the caller's marketplace installation record --
 * the same lifecycle actions as before #2193, now only rendered for entries
 * that actually have such a record (a runtime-only plugin has nothing for these
 * marketplace endpoints to act on). */
function InstallationActions({
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
    <>
      <div className="flex flex-shrink-0 items-center gap-2">
        <button onClick={handleToggle} disabled={busy} className={secondaryButtonClass}>
          {installation.enabled ? "Disable" : "Enable"}
        </button>
        <button onClick={handleUninstall} disabled={busy} className={destructiveButtonClass}>
          <Icon name="delete" size={15} /> Uninstall
        </button>
      </div>
      {status && (
        <StatusLine isError={isError} className="mt-2 basis-full">
          {status}
        </StatusLine>
      )}
    </>
  );
}

export function InstalledPluginCard({
  entry,
  token,
  runtimeKnown = false,
  onUninstalled,
  onToggleEnabled,
  confirm,
}: {
  entry: InstalledEntry;
  token: string;
  /** Whether plugin-registry's runtime list loaded, i.e. whether a missing
   * `entry.runtime` means "not running" rather than "unknown". */
  runtimeKnown?: boolean;
  onUninstalled: (pluginId: string) => void;
  onToggleEnabled: (pluginId: string, enabled: boolean) => void;
  confirm: ReturnType<typeof useConfirm>["confirm"];
}) {
  const { installation, runtime } = entry;
  const hasVersion = entry.installedVersion !== null;
  const hasNeeds = entry.requiresServices.length > 0;

  return (
    <section className={`mb-4 ${cardClass}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
            <Icon name="plugins" size={16} className="shrink-0 text-indigo-500 dark:text-indigo-400" /> {entry.displayName}
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <SourceBadge source={entry.source} />
            <RuntimeState runtime={runtime} runtimeKnown={runtimeKnown} />
            {installation && (
              <span className={badgeClass}>
                {installation.enabled ? "✓ Your install: enabled" : "Your install: disabled"}
              </span>
            )}
          </div>
          {(hasVersion || hasNeeds) && (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 text-xs text-gray-500 dark:text-gray-400">
              {hasVersion && (
                <PluginVersion installed={entry.installedVersion} listed={entry.listedVersion} />
              )}
              {hasNeeds && <span>Needs: {entry.requiresServices.join(", ")}</span>}
            </p>
          )}
          {!installation && runtime && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Loaded by this installation for everyone — there's no marketplace install
              of yours to enable, disable or uninstall.
            </p>
          )}
        </div>
        {installation && (
          <InstallationActions
            installation={installation}
            token={token}
            onUninstalled={onUninstalled}
            onToggleEnabled={onToggleEnabled}
            confirm={confirm}
          />
        )}
      </div>
      <ConfigurePanel name={entry.name} token={token} />
    </section>
  );
}

/** Placeholder cards while the first load is in flight -- the page never shows
 * its "nothing installed" state before it actually knows (#2195). */
function InstalledSkeleton() {
  return (
    <div aria-hidden="true">
      {[0, 1].map((i) => (
        <div key={i} className={`mb-4 ${cardClass}`}>
          <Skeleton className="h-5 w-48" />
          <div className="mt-2 flex gap-1.5">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-40" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function InstalledPluginsPage() {
  const { token, sessionKey, isAuthenticated } = useAuth();
  const tokenRef = useTokenRef();
  const { confirm, dialog } = useConfirm();
  const {
    entries,
    loading,
    runtime,
    installationsError,
    runtimeError,
    catalogError,
    runtimeTruncated,
    catalogTruncated,
    reload,
    removeInstallation,
    setInstallationEnabled,
  } = useInstalledPlugins({ enabled: isAuthenticated, tokenRef, sessionKey });

  const hasError = !!installationsError || !!runtimeError;
  const firstLoad = loading && entries.length === 0;
  const isEmpty = !loading && !hasError && entries.length === 0;

  return (
    <>
      {dialog}
      <PageHeader
        icon="plugins"
        title="Installed Plugins"
        subtitle="Everything running on this installation, plus the plugins you've installed from the marketplace — check versions and health, enable, disable, uninstall, or edit their settings. Requires login."
      />
      {!isAuthenticated && (
        <InfoCallout icon="lock">
          Log in (top right) to see your installed plugins.
        </InfoCallout>
      )}
      {isAuthenticated && (
        <>
          {loading && <StatusLine>Loading installed plugins…</StatusLine>}
          {installationsError && (
            <StatusLine isError>
              Couldn't load your marketplace installs: {installationsError}
            </StatusLine>
          )}
          {runtimeError && (
            <StatusLine isError>
              Couldn't load the plugins running on this installation: {runtimeError}
            </StatusLine>
          )}
          {hasError && !loading && (
            <button onClick={reload} className={`mb-4 ${secondaryButtonClass}`}>
              <Icon name="reset" size={15} /> Retry
            </button>
          )}
          {catalogError && !loading && (
            <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
              Source and listed-version details are unavailable right now ({catalogError}).
            </p>
          )}
          {(runtimeTruncated || catalogTruncated) && !loading && (
            <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
              {runtimeTruncated && catalogTruncated
                ? "Only part of the runtime plugin list and the catalog could be loaded, so some plugins, source badges and listed versions may be missing."
                : runtimeTruncated
                  ? "Only part of the runtime plugin list could be loaded, so some running plugins may be missing here."
                  : "Only part of the catalog could be loaded, so some source badges and listed versions may be missing."}
            </p>
          )}
          {firstLoad && <InstalledSkeleton />}
          {isEmpty && (
            <EmptyState>
              No plugins installed yet —{" "}
              <Link to="/plugins/available" className="underline hover:text-indigo-600 dark:hover:text-indigo-400">
                browse Available Plugins
              </Link>
              .
            </EmptyState>
          )}
          {entries.length > 0 && (
            <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
              Some of these expose AI tools the assistant can call —{" "}
              <Link to="/ai-tools/installed" className="underline hover:text-indigo-600 dark:hover:text-indigo-400">
                check Live Tools
              </Link>{" "}
              to see which are live right now.
            </p>
          )}
          {entries.map((entry) => (
            <InstalledPluginCard
              key={entry.name}
              entry={entry}
              token={token}
              runtimeKnown={runtime !== null && !runtimeTruncated}
              onUninstalled={removeInstallation}
              onToggleEnabled={setInstallationEnabled}
              confirm={confirm}
            />
          ))}
        </>
      )}
    </>
  );
}
