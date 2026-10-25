import { useId, useState } from "react";
import { Link } from "react-router-dom";

import { useI18n } from "../i18n";
import { friendlyErrorMessage } from "../lib/api";
import {
  createAccessRequest,
  createRefusal,
  notifyRequestsChanged,
  useActiveOrgId,
  type AccessRequestKind,
} from "../lib/accessRequests";
import { useAuth } from "../lib/auth";
import { deploymentMode } from "../lib/billing";
import { ROUTES } from "../lib/routes";
import { fieldHintClass, inputClass, primaryButtonClass, secondaryButtonClass } from "../lib/ui";
import { useModal } from "../lib/useModal";
import { Dialog } from "./Dialog";
import { Icon } from "./Icon";
import { StatusLine } from "./StatusLine";

/** "Request install", "Request a model", "Ask to join": a member asks for
 * what they can't do themselves (client#126 Q2, Q3, Q4). Opens a short form
 * (what, plus an optional note), sends the request and says where the answer
 * will show. Renders nothing without a session in an organization. Callers
 * show it only to people who can't do the thing directly. */
export function RequestButton({
  kind,
  subject,
  teamId,
  name,
  className = secondaryButtonClass,
}: {
  kind: AccessRequestKind;
  /** The plugin asked for. Omitted for a model request: the member types it. */
  subject?: string;
  /** team_join: the team. */
  teamId?: number;
  /** What the request is about, for the button's and dialog's text. */
  name?: string;
  className?: string;
}) {
  const { token } = useAuth();
  const orgId = useActiveOrgId();
  const { t, formatDate } = useI18n();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const modal = useModal({ open, onDismiss: () => !busy && close() });

  if (!token || orgId === null) return null;

  const copy = {
    team_join: { button: t("requests.send.teamJoin"), title: t("requests.send.teamJoinTitle", { name: name ?? "" }) },
    plugin_install: { button: t("requests.send.pluginInstall"), title: t("requests.send.pluginInstallTitle", { name: name ?? "" }) },
    model_request: { button: t("requests.send.model"), title: t("requests.send.modelTitle") },
    plan_request:
      deploymentMode === "saas"
        ? { button: t("requests.send.planBillingOwner"), title: t("requests.send.planTitle", { name: name ?? "" }) }
        : { button: t("requests.send.planLicence"), title: t("requests.send.planLicenceTitle", { name: name ?? "" }) },
  }[kind];
  const askSubject = kind === "model_request" && subject === undefined;

  function close() {
    modal.close();
    setOpen(false);
    setError("");
    setNote("");
    setTyped("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const what = askSubject ? typed.trim() : subject;
    if (askSubject && !what) {
      setError(t("requests.send.subjectRequired"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await createAccessRequest(
        {
          kind,
          organization_id: orgId as number,
          ...(teamId !== undefined ? { team_id: teamId } : {}),
          ...(what ? { subject: what } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        token,
      );
      setSent(true);
      notifyRequestsChanged();
    } catch (err) {
      const refusal = createRefusal(err);
      if (refusal?.code === "exists") setError(t("requests.send.exists"));
      else if (refusal?.code === "cooldown") {
        setError(
          [
            refusal.until
              ? t("requests.send.cooldown", { date: formatDate(refusal.until, { dateStyle: "medium" }) })
              : t("requests.send.cooldownNoDate"),
            refusal.reason ? t("requests.reason", { reason: refusal.reason }) : "",
          ]
            .filter(Boolean)
            .join(" "),
        );
      } else setError(friendlyErrorMessage(err));
    }
    setBusy(false);
  }

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setOpen(true)}
        disabled={sent}
        aria-label={name && !sent ? `${copy.button}: ${name}` : undefined}
      >
        <Icon name={sent ? "check" : "send"} size={15} />
        {sent ? t("requests.send.sentButton") : copy.button}
      </button>
      {open && (
        <Dialog
          modal={modal}
          title={copy.title}
          description={
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              {sent
                ? t("requests.send.sent")
                : kind === "team_join"
                  ? t("requests.send.teamJoinRoute")
                  : kind === "plan_request"
                    ? t(deploymentMode === "saas" ? "requests.send.planRoute" : "requests.send.planLicenceRoute")
                    : t("requests.send.adminRoute")}
            </p>
          }
        >
          {sent ? (
            <div className="mt-5 flex justify-end gap-2">
              <Link to={ROUTES.myRequests} className={secondaryButtonClass} onClick={close}>
                {t("requests.send.viewRequests")}
              </Link>
              <button type="button" autoFocus className={primaryButtonClass} onClick={close}>
                {t("requests.send.close")}
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3">
              {askSubject && (
                <div>
                  <label htmlFor={`${ids}-subject`} className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t("requests.send.subjectLabel")}
                  </label>
                  <input
                    id={`${ids}-subject`}
                    data-autofocus
                    className={inputClass}
                    value={typed}
                    maxLength={200}
                    placeholder={t("requests.send.subjectPlaceholder")}
                    onChange={(e) => setTyped(e.target.value)}
                    disabled={busy}
                  />
                </div>
              )}
              <div>
                <label htmlFor={`${ids}-note`} className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t("requests.send.noteLabel")}
                </label>
                <textarea
                  id={`${ids}-note`}
                  {...(askSubject ? {} : { "data-autofocus": true })}
                  className={inputClass}
                  rows={3}
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  aria-describedby={`${ids}-note-hint`}
                  disabled={busy}
                />
                <p id={`${ids}-note-hint`} className={fieldHintClass}>
                  {t("requests.send.noteHint")}
                </p>
              </div>
              {error && (
                <StatusLine isError className="mb-0">
                  {error}
                </StatusLine>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" className={secondaryButtonClass} onClick={close} disabled={busy}>
                  {t("common.cancel")}
                </button>
                <button type="submit" className={primaryButtonClass} disabled={busy}>
                  {busy ? t("common.sending") : t("requests.send.submit")}
                </button>
              </div>
            </form>
          )}
        </Dialog>
      )}
    </>
  );
}
