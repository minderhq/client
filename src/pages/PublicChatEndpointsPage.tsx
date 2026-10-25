import { useState } from "react";
import { Link } from "react-router-dom";

import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { InfoCallout } from "../components/InfoCallout";
import { PageHeader } from "../components/PageHeader";
import { StatusLine } from "../components/StatusLine";
import { useConfirm } from "../components/ConfirmDialog";
import { useI18n } from "../i18n";
import { apiBaseUrl, apiFetch, friendlyErrorMessage } from "../lib/api";
import type { Paginated } from "../lib/api";
import { useAuth } from "../lib/auth";
import { copyText, useAutoClearTimeout } from "../lib/browser";
import {
  badgeClass,
  badgeTone,
  destructiveButtonClass,
  fieldHintClass,
  ghostButtonClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../lib/ui";
import { useAsyncResource } from "../lib/useAsyncResource";
import { chatbotConversationsRoute } from "../lib/routes";

// #1581 (client half of #1522): admin-only management of PUBLIC chat endpoints.
// Each endpoint binds one RAG pipeline (its knowledge bases + retrieval config)
// to a public slug that an anonymous browser can chat against, at a
// per-endpoint rate limit. This page is CRUD over the admin API
// (/v1/public-chat/endpoints); the anonymous chat surface itself
// (/public/chat/{slug}/...) and the conversation dashboard (#1582) are separate
// follow-ups and deliberately NOT built here.
//
// Admin-gated to mirror the backend's _require_endpoint_admin: exposing an
// outward-facing surface is an org owner/admin action, never a plain member's.

/** The admin-facing endpoint shape returned by the gateway's _public_view. The
 * id is the numeric primary key (path param is `{endpoint_id}: int`). */
export interface PublicChatEndpoint {
  id: number;
  tenant_id: string;
  name: string;
  slug: string;
  pipeline_id: string;
  rag_config: Record<string, unknown>;
  enabled: boolean;
  rate_limit_per_minute: number;
  /** Comma-separated origins allowed to embed the chatbot; null = none. */
  allowed_origins?: string | null;
  shareable_link?: boolean;
  created_at: string | null;
  updated_at: string | null;
}

/** Minimal pipeline shape for the binding picker — the create/edit forms only
 * need the id (sent to the API) and the name (shown to the admin). */
export interface PipelineOption {
  id: string;
  name: string;
}

// The RAG retrieval methods rag-pipeline exposes (see RagPipelinesPage's own
// Method union). Selecting one stores it as rag_config.method; "(pipeline
// default)" leaves rag_config empty so the endpoint inherits the pipeline's own
// behaviour. Kept intentionally small — advanced per-method tuning is a
// follow-up, this covers the common "make it use HyDE/Self-RAG" need.
const RAG_METHODS = [
  "standard",
  "hyde",
  "self_rag",
  "auto",
  "corrective",
  "raptor",
] as const;

/** The endpoint's configured method, or "" when it inherits the pipeline
 * default. Only `method` is surfaced from the otherwise-freeform rag_config. */
function methodOf(ragConfig: Record<string, unknown> | undefined | null): string {
  const m = ragConfig?.method;
  return typeof m === "string" ? m : "";
}

/** rag_config payload for a chosen method — an empty object when the admin left
 * it on the pipeline default, so the backend stores no override. */
function ragConfigForMethod(method: string): Record<string, unknown> {
  return method ? { method } : {};
}

/** The hosted visitor page for a slug. Built from the configured gateway base
 * URL (VITE_API_BASE_URL), never a hardcoded host, so a gateway served under
 * /api yields /api/public/chat/... (the embed snippet below likewise). */
function publicUrlForSlug(slug: string): string {
  return `${apiBaseUrl}/public/chat/${slug}`;
}

/** The one-line embed loader snippet for a slug. */
function embedCodeForSlug(slug: string): string {
  return `<script src="${apiBaseUrl}/public/chat/widget.js" data-bot="${slug}" async></script>`;
}

/** POST .../preview-token response (untyped in the spec); `url` is relative
 * to the gateway base and stays valid for 10 minutes. */
interface PreviewToken {
  token: string;
  expires_in: number;
  url: string;
}

/** The endpoint's allowed origins as a list (the API stores them comma-separated). */
function originsOf(raw: string | null | undefined): string[] {
  return (raw ?? "").split(",").map((o) => o.trim()).filter(Boolean);
}

const SLUG_PATTERN = "[a-zA-Z0-9._-]+";

function CreateEndpointForm({
  token,
  pipelines,
  onCreated,
}: {
  token: string;
  pipelines: PipelineOption[];
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [pipelineId, setPipelineId] = useState("");
  const [rateLimit, setRateLimit] = useState(20);
  const [method, setMethod] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);

  function reset() {
    setName("");
    setSlug("");
    setPipelineId("");
    setRateLimit(20);
    setMethod("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return; // already in flight — ignore a double-submit
    if (!pipelineId) {
      setStatus(t("publicChat.pickAssistant"));
      setIsError(true);
      return;
    }
    setBusy(true);
    setIsError(false);
    setStatus("Creating…");
    try {
      await apiFetch("/v1/public-chat/endpoints", {
        method: "POST",
        token,
        body: {
          name: name.trim(),
          slug: slug.trim(),
          pipeline_id: pipelineId,
          rate_limit_per_minute: rateLimit,
          rag_config: ragConfigForMethod(method),
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

  if (pipelines.length === 0) {
    return (
      <EmptyState className="mb-4">
        {t("publicChat.needsAssistant")}
      </EmptyState>
    );
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className={primaryButtonClass}>
        <Icon name="plus" size={15} /> {t("publicChat.newChatbot")}
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
          Name
        </label>
        <input
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Support Bot"
          required
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          Slug
        </label>
        <input
          className={inputClass}
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="e.g. support"
          pattern={SLUG_PATTERN}
          title="Letters, numbers, dot, underscore or hyphen only"
          required
        />
        <p className={fieldHintClass}>
          The public address for this chatbot. Letters, numbers,{" "}
          <code>.</code> <code>_</code> <code>-</code> only — it can't be changed
          later.
        </p>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t("publicChat.assistant")}
        </label>
        <select
          className={inputClass}
          value={pipelineId}
          onChange={(e) => setPipelineId(e.target.value)}
          required
        >
          <option value="" disabled>
            {t("publicChat.chooseAssistant")}
          </option>
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <p className={fieldHintClass}>
          {t("publicChat.assistantHint")}
        </p>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          Rate limit{" "}
          <span className="font-normal text-gray-400">(requests / minute)</span>
        </label>
        <input
          type="number"
          className={inputClass}
          value={rateLimit}
          min={1}
          max={600}
          onChange={(e) => setRateLimit(Number(e.target.value))}
          required
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          RAG method{" "}
          <span className="font-normal text-gray-400">(optional)</span>
        </label>
        <select
          className={inputClass}
          value={method}
          onChange={(e) => setMethod(e.target.value)}
        >
          <option value="">{t("assistants.default")}</option>
          {RAG_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy} className={primaryButtonClass}>
          {busy ? "Creating…" : "Create"}
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

function EndpointRow({
  endpoint,
  token,
  pipelines,
  onChanged,
  confirm,
}: {
  endpoint: PublicChatEndpoint;
  token: string;
  pipelines: PipelineOption[];
  onChanged: () => void;
  confirm: ReturnType<typeof useConfirm>["confirm"];
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(endpoint.name);
  const [pipelineId, setPipelineId] = useState(endpoint.pipeline_id);
  const [rateLimit, setRateLimit] = useState(endpoint.rate_limit_per_minute);
  const [method, setMethod] = useState(methodOf(endpoint.rag_config));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [copied, setCopied] = useState<"" | "embed" | "link">("");
  const scheduleTimeout = useAutoClearTimeout();
  const { t } = useI18n();

  const pipelineName =
    pipelines.find((p) => p.id === endpoint.pipeline_id)?.name ??
    endpoint.pipeline_id;
  const publicUrl = publicUrlForSlug(endpoint.slug);

  function startEdit() {
    setName(endpoint.name);
    setPipelineId(endpoint.pipeline_id);
    setRateLimit(endpoint.rate_limit_per_minute);
    setMethod(methodOf(endpoint.rag_config));
    setStatus("");
    setIsError(false);
    setEditing(true);
  }

  async function handleCopy(what: "embed" | "link") {
    const text = what === "embed" ? embedCodeForSlug(endpoint.slug) : publicUrl;
    if (!(await copyText(text))) return;
    setCopied(what);
    scheduleTimeout(() => setCopied(""), 1500);
  }

  async function handlePreview() {
    if (busy) return;
    // Open the tab synchronously, inside the click, so popup blockers allow it;
    // it is pointed at the preview URL once the token arrives.
    const tab = window.open("", "_blank");
    setBusy(true);
    setIsError(false);
    setStatus("");
    try {
      const { url } = await apiFetch<PreviewToken>(
        `/v1/public-chat/endpoints/${endpoint.id}/preview-token`,
        { method: "POST", token },
      );
      const absolute = `${apiBaseUrl}${url}`;
      if (tab) {
        tab.opener = null;
        tab.location.href = absolute;
      } else {
        window.open(absolute, "_blank", "noopener");
      }
    } catch (e) {
      tab?.close();
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    }
    setBusy(false);
  }

  async function handleShareableToggle() {
    if (busy) return;
    setBusy(true);
    setIsError(false);
    setStatus("");
    try {
      await apiFetch(`/v1/public-chat/endpoints/${endpoint.id}`, {
        method: "PATCH",
        token,
        body: { shareable_link: !endpoint.shareable_link },
      });
      onChanged();
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    }
    setBusy(false);
  }

  async function handleSave() {
    if (busy) return;
    if (!name.trim()) {
      setStatus("Name can't be empty.");
      setIsError(true);
      return;
    }
    setBusy(true);
    setIsError(false);
    setStatus("Saving…");
    try {
      await apiFetch(`/v1/public-chat/endpoints/${endpoint.id}`, {
        method: "PATCH",
        token,
        body: {
          name: name.trim(),
          pipeline_id: pipelineId,
          rate_limit_per_minute: rateLimit,
          rag_config: ragConfigForMethod(method),
        },
      });
      setEditing(false);
      setStatus("");
      onChanged();
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    }
    setBusy(false);
  }

  async function handleToggle() {
    if (busy) return;
    setBusy(true);
    setIsError(false);
    setStatus("");
    try {
      await apiFetch(`/v1/public-chat/endpoints/${endpoint.id}`, {
        method: "PATCH",
        token,
        body: { enabled: !endpoint.enabled },
      });
      onChanged();
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    }
    setBusy(false);
  }

  async function handleDelete() {
    if (
      !(await confirm({
        title: t("publicChat.deleteTitle"),
        message: `Remove "${endpoint.name}"? Its public address (/${endpoint.slug}) will stop working immediately.`,
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
      await apiFetch(`/v1/public-chat/endpoints/${endpoint.id}`, {
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
      {editing ? (
        <div className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              Name
            </label>
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label={t("publicChat.nameLabel")}
              disabled={busy}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              {t("publicChat.assistant")}
            </label>
            <select
              className={inputClass}
              value={pipelineId}
              onChange={(e) => setPipelineId(e.target.value)}
              aria-label={t("publicChat.boundAssistant")}
              disabled={busy}
            >
              {/* Keep the current binding selectable even if it's no longer in
                  the fetched list (e.g. a pipeline the caller can't re-list). */}
              {!pipelines.some((p) => p.id === endpoint.pipeline_id) && (
                <option value={endpoint.pipeline_id}>
                  {endpoint.pipeline_id}
                </option>
              )}
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              Rate limit (requests / minute)
            </label>
            <input
              type="number"
              className={inputClass}
              value={rateLimit}
              min={1}
              max={600}
              onChange={(e) => setRateLimit(Number(e.target.value))}
              aria-label="Rate limit per minute"
              disabled={busy}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              RAG method
            </label>
            <select
              className={inputClass}
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              aria-label="RAG method"
              disabled={busy}
            >
              <option value="">{t("assistants.default")}</option>
              {RAG_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={busy}
              className={primaryButtonClass}
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => setEditing(false)}
              disabled={busy}
              className={secondaryButtonClass}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-gray-900 dark:text-gray-100">
              {endpoint.name}
            </span>
            <span
              className={`${badgeClass} ${endpoint.enabled ? badgeTone.success : badgeTone.warn}`}
            >
              {endpoint.enabled ? "enabled" : "disabled"}
            </span>
            <span className={badgeClass}>{endpoint.rate_limit_per_minute}/min</span>
            {methodOf(endpoint.rag_config) && (
              <span className={badgeClass}>{methodOf(endpoint.rag_config)}</span>
            )}
            <div className="ml-auto flex items-center gap-2">
              {/* Read-only creator dashboard: the anonymous conversations that
                  flowed through this endpoint (#1582). */}
              <Link
                to={chatbotConversationsRoute(endpoint.id)}
                className={secondaryButtonClass}
              >
                <Icon name="conversations" size={14} /> Conversations
              </Link>
              <button
                onClick={startEdit}
                disabled={busy}
                className={secondaryButtonClass}
              >
                <Icon name="edit" size={14} /> Edit
              </button>
              <button
                onClick={handleToggle}
                disabled={busy}
                className={ghostButtonClass}
              >
                {endpoint.enabled ? "Disable" : "Enable"}
              </button>
              <button
                onClick={handleDelete}
                disabled={busy}
                className={destructiveButtonClass}
              >
                <Icon name="delete" size={14} /> Delete
              </button>
            </div>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
            <span>
              {t("publicChat.assistant")}:{" "}
              <span className="font-medium text-gray-700 dark:text-gray-300">
                {pipelineName}
              </span>
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleCopy("embed")}
              className={secondaryButtonClass}
            >
              <Icon name="copy" size={14} />{" "}
              {copied === "embed" ? t("publicChat.embedCopied") : t("publicChat.copyEmbed")}
            </button>
            <button
              type="button"
              onClick={handlePreview}
              disabled={busy}
              title={t("publicChat.previewHint")}
              className={secondaryButtonClass}
            >
              {t("publicChat.preview")}
            </button>
            <label className="flex items-center gap-1 text-xs text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={!!endpoint.shareable_link}
                onChange={handleShareableToggle}
                disabled={busy}
              />
              {t("publicChat.shareableLink")}
            </label>
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t("publicChat.shareableLinkHint")}
          </p>
          {endpoint.shareable_link && (
            <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
              {t("publicChat.publicLinkLabel")}:{" "}
              <span className="font-mono" data-testid="public-chat-link">
                {publicUrl}
              </span>
              <button
                type="button"
                onClick={() => handleCopy("link")}
                aria-label={t("publicChat.copyPublicLink")}
                title={t("publicChat.copyPublicLink")}
                className="underline hover:text-gray-700 dark:hover:text-gray-200"
              >
                {copied === "link" ? "copied" : "copy"}
              </button>
            </div>
          )}
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {originsOf(endpoint.allowed_origins).length > 0
              ? t("publicChat.allowedSites", {
                  origins: originsOf(endpoint.allowed_origins).join(", "),
                })
              : t("publicChat.noAllowedSites")}
          </p>
        </>
      )}
      {status && (
        <StatusLine isError={isError} className="mb-0 mt-2">
          {status}
        </StatusLine>
      )}
    </div>
  );
}

export function PublicChatEndpointsPage() {
  const { t } = useI18n();
  const { token, orgRole, isPlatformAdmin } = useAuth();
  // Mirrors the server gate (_require_endpoint_admin): the Platform Admin or an
  // owner/admin of the active org. Switch to useCan("org.chatbots.manage")
  // once the server enforces that key.
  const isAdmin = !!isPlatformAdmin || orgRole === "owner" || orgRole === "admin";
  const { confirm, dialog } = useConfirm();

  const endpointsRes = useAsyncResource(
    (signal) =>
      apiFetch<Paginated<PublicChatEndpoint>>(
        "/v1/public-chat/endpoints?limit=100",
        { token, signal },
      ),
    { enabled: isAdmin },
  );

  // The pipeline picker for create/edit. Owner-scoped under tenancy, so it needs
  // the token; a failure here shouldn't blank the whole page, so it degrades to
  // an empty list (the create form then prompts to make a pipeline first).
  const pipelinesRes = useAsyncResource(
    (signal) =>
      apiFetch<Paginated<PipelineOption>>("/v1/rag/pipeline?limit=100", {
        token,
        signal,
        cache: true,
      }),
    { enabled: isAdmin },
  );

  const endpoints = endpointsRes.data?.items ?? [];
  const pipelines = pipelinesRes.data?.items ?? [];

  return (
    <>
      {dialog}
      <PageHeader
        icon="ask"
        title={t("nav.items.publicChat.label")}
        subtitle={t("publicChat.subtitle")}
      />

      {!isAdmin && (
        <InfoCallout icon="lock">
          {token
            ? t("publicChat.adminRequired")
            : t("publicChat.logInAsAdmin")}
        </InfoCallout>
      )}

      {isAdmin && (
        <>
          <div className="mb-4">
            <CreateEndpointForm
              token={token}
              pipelines={pipelines}
              onCreated={endpointsRes.reload}
            />
          </div>

          <StatusLine isError={!!endpointsRes.error}>
            {endpointsRes.error ??
              (endpointsRes.loading ? "Loading…" : "")}
          </StatusLine>

          {!endpointsRes.loading &&
            !endpointsRes.error &&
            endpoints.length === 0 && (
              <EmptyState>{t("publicChat.empty")}</EmptyState>
            )}

          {endpoints.map((ep) => (
            <EndpointRow
              key={ep.id}
              endpoint={ep}
              token={token}
              pipelines={pipelines}
              onChanged={endpointsRes.reload}
              confirm={confirm}
            />
          ))}
        </>
      )}
    </>
  );
}
