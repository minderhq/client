import { type ChangeEvent, useId, useState } from "react";

import { useConfirm } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { LoadError } from "../components/LoadError";
import { PeopleHeader } from "../components/PeopleHeader";
import { Skeleton } from "../components/Skeleton";
import { StatusLine } from "../components/StatusLine";
import { useI18n, type Messages } from "../i18n";
import { friendlyErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { copyText } from "../lib/browser";
import {
  createOrgInvite,
  fetchMyOrgs,
  fetchOrgInvites,
  type MyOrg,
  type OrgInvite,
  ORG_ROLES,
  orgRoleTone,
  pickActiveOrg,
  revokeOrgInvite,
} from "../lib/orgs";
import { BULK_INVITE_MAX, bulkInvite, type BulkInviteResult, parseEmailList } from "../lib/people";
import {
  badgeBaseClass,
  badgeClass,
  badgeNeutralToneClass,
  badgeTone,
  cardClass,
  fieldHintClass,
  inputClass,
  mutedTextClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../lib/ui";
import { useAsyncResource } from "../lib/useAsyncResource";
import { useRoleLabel } from "../lib/usePeople";

type InviteStatus = keyof Messages["people"]["invites"]["status"];

const STATUS_TONE: Record<InviteStatus, string> = {
  pending: badgeTone.warn,
  accepted: badgeTone.success,
  revoked: badgeNeutralToneClass,
  expired: badgeNeutralToneClass,
};

const labelClass = "mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300";
const headingClass = "mb-3 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100";

/** Organization › People › Invites (UX step 7, scenario S36): invite one
 * person or a pasted / uploaded list, see each address's outcome, and the
 * org's invites with Copy link and Revoke. The gateway sends no invite
 * email yet, so the admin shares the link. */
export function PeopleInvitesPage() {
  const { isAuthenticated, token, sessionKey, activeTenantId } = useAuth();
  const { t } = useI18n();
  const { confirm, dialog } = useConfirm();
  const pendingHeadingId = useId();

  const orgsRes = useAsyncResource<MyOrg[]>(
    (signal) => fetchMyOrgs(token, signal).then((r) => r.organizations),
    { deps: [sessionKey], enabled: isAuthenticated },
  );
  const active = pickActiveOrg(orgsRes.data ?? [], activeTenantId);
  const invitesRes = useAsyncResource<OrgInvite[]>(
    (signal) => fetchOrgInvites(active!.id, token, signal).then((r) => r.invites),
    { deps: [sessionKey, active?.id], enabled: isAuthenticated && !!active },
  );

  const [listStatus, setListStatus] = useState("");
  const [listError, setListError] = useState(false);

  async function handleRevoke(inv: OrgInvite) {
    if (!active) return;
    const ok = await confirm({
      title: t("people.invites.revokeTitle"),
      message: t("people.invites.revokeMessage", { email: inv.email }),
      confirmLabel: t("people.invites.revoke"),
      danger: true,
    });
    if (!ok) return;
    try {
      await revokeOrgInvite(active.id, inv.id, token);
      invitesRes.reload();
      setListStatus(t("people.invites.revoked"));
      setListError(false);
    } catch (e) {
      setListStatus(friendlyErrorMessage(e));
      setListError(true);
    }
  }

  async function handleCopy(inv: OrgInvite) {
    const ok = await copyText(`${window.location.origin}/invite/${inv.token}`);
    setListStatus(ok ? t("people.invites.copied") : t("people.invites.copyFailed"));
    setListError(!ok);
  }

  const invites = invitesRes.data ?? [];

  return (
    <>
      {dialog}
      <PeopleHeader title={t("nav.items.peopleInvites.title")} subtitle={t("people.invites.subtitle")} />
      {orgsRes.error && (
        <LoadError
          title={t("people.orgLoadError")}
          message={orgsRes.error}
          onRetry={orgsRes.reload}
          what={t("nav.items.peopleInvites.title")}
        />
      )}
      {orgsRes.data && !active && <EmptyState>{t("people.noOrg")}</EmptyState>}

      {active && (
        <>
          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <SingleInvite org={active} onSent={invitesRes.reload} />
            <BulkInvite org={active} onSent={invitesRes.reload} />
          </div>

          <section className={cardClass} aria-labelledby={pendingHeadingId}>
            <h2 id={pendingHeadingId} className={headingClass}>
              <Icon name="mail" size={17} className="text-indigo-500 dark:text-indigo-400" />
              {t("people.invites.listHeading")}
            </h2>
            <StatusLine isError={listError}>{listStatus}</StatusLine>
            {invitesRes.error ? (
              <LoadError
                title={t("people.invites.loadError")}
                message={invitesRes.error}
                onRetry={invitesRes.reload}
                what={t("people.invites.listHeading")}
              />
            ) : invitesRes.loading && !invitesRes.data ? (
              <div aria-busy="true">
                <span className="sr-only">{t("common.loading")}</span>
                <Skeleton className="h-16 w-full" />
              </div>
            ) : invites.length === 0 ? (
              <EmptyState>{t("people.invites.empty")}</EmptyState>
            ) : (
              <ul className="flex flex-col divide-y divide-gray-100 dark:divide-gray-800">
                {invites.map((inv) => (
                  <InviteRow
                    key={inv.id}
                    invite={inv}
                    onCopy={() => handleCopy(inv)}
                    onRevoke={() => handleRevoke(inv)}
                  />
                ))}
              </ul>
            )}
            <p className={`mt-3 ${mutedTextClass}`}>{t("people.invites.howTo", { org: active.name })}</p>
          </section>
        </>
      )}
    </>
  );
}

function InviteRow({
  invite: inv,
  onCopy,
  onRevoke,
}: {
  invite: OrgInvite;
  onCopy: () => void;
  onRevoke: () => void;
}) {
  const { t, messages, formatDate } = useI18n();
  const roleLabel = useRoleLabel();
  const known = Object.hasOwn(messages.people.invites.status, inv.status);
  const tone = known ? STATUS_TONE[inv.status as InviteStatus] : badgeNeutralToneClass;
  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">{inv.email}</span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <span className={`${badgeBaseClass} ${tone}`}>
            {known ? t(`people.invites.status.${inv.status as InviteStatus}`) : inv.status}
          </span>
          {inv.max_uses > 1 && <span>{t("people.invites.uses", { uses: inv.uses, max: inv.max_uses })}</span>}
          {inv.status === "pending" && inv.expires_at && (
            <span>{t("people.invites.expires", { date: formatDate(inv.expires_at, { dateStyle: "medium" }) })}</span>
          )}
        </span>
      </span>
      {inv.org_role && <span className={`${badgeClass} ${orgRoleTone(inv.org_role)}`}>{roleLabel(inv.org_role)}</span>}
      {inv.status === "pending" && (
        <>
          <button
            type="button"
            onClick={onCopy}
            className={`${secondaryButtonClass} shrink-0`}
            aria-label={t("people.invites.copyFor", { email: inv.email })}
          >
            <Icon name="copy" size={15} />
            <span className="hidden sm:inline">{t("people.invites.copy")}</span>
          </button>
          <button
            type="button"
            onClick={onRevoke}
            className={`${secondaryButtonClass} shrink-0 text-red-600 dark:text-red-400`}
            aria-label={t("people.invites.revokeFor", { email: inv.email })}
          >
            <Icon name="close" size={15} />
            <span className="hidden sm:inline">{t("people.invites.revoke")}</span>
          </button>
        </>
      )}
    </li>
  );
}

/** A role picker for an invite. */
function RoleSelect({ id, value, onChange, disabled }: {
  id: string;
  value: string;
  onChange: (role: string) => void;
  disabled: boolean;
}) {
  const roleLabel = useRoleLabel();
  return (
    <select id={id} className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      {ORG_ROLES.map((r) => (
        <option key={r} value={r}>
          {roleLabel(r)}
        </option>
      ))}
    </select>
  );
}

function SingleInvite({ org, onSent }: { org: MyOrg; onSent: () => void }) {
  const { token } = useAuth();
  const { t } = useI18n();
  const emailId = useId();
  const roleId = useId();
  const headingId = useId();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const address = email.trim();
    if (!address) return;
    setBusy(true);
    setStatus(t("common.sending"));
    setIsError(false);
    try {
      await createOrgInvite(org.id, { email: address, org_role: role }, token);
      onSent();
      setStatus(t("people.invites.sent", { email: address }));
      setEmail("");
      setRole("member");
    } catch (err) {
      setStatus(friendlyErrorMessage(err));
      setIsError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={cardClass} aria-labelledby={headingId}>
      <h2 id={headingId} className={headingClass}>
        <Icon name="user" size={17} className="text-indigo-500 dark:text-indigo-400" />
        {t("people.invites.singleHeading")}
      </h2>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div>
          <label htmlFor={emailId} className={labelClass}>
            {t("people.invites.email")}
          </label>
          <input
            id={emailId}
            type="email"
            required
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            placeholder={t("people.invites.emailPlaceholder")}
          />
        </div>
        <div>
          <label htmlFor={roleId} className={labelClass}>
            {t("people.role")}
          </label>
          <RoleSelect id={roleId} value={role} onChange={setRole} disabled={busy} />
        </div>
        <div>
          <button type="submit" disabled={busy || !email.trim()} className={primaryButtonClass}>
            <Icon name="mail" size={16} />
            {t("people.invites.send")}
          </button>
        </div>
        <StatusLine isError={isError} className="mb-0">
          {status}
        </StatusLine>
      </form>
    </section>
  );
}

function BulkInvite({ org, onSent }: { org: MyOrg; onSent: () => void }) {
  const { token } = useAuth();
  const { t, plural, messages } = useI18n();
  const listId = useId();
  const hintId = useId();
  const fileId = useId();
  const roleId = useId();
  const headingId = useId();
  const [text, setText] = useState("");
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<BulkInviteResult[] | null>(null);
  const { emails, invalid } = parseEmailList(text);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const content = await file.text();
    setText((prev) => (prev.trim() ? `${prev}\n${content}` : content));
    e.target.value = "";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (emails.length === 0) return;
    setBusy(true);
    setError("");
    setResults(null);
    try {
      const out = await bulkInvite(org.id, emails, role, token);
      setResults(out);
      onSent();
      // Keep only what failed, so fixing and resending is one click.
      setText(out.filter((r) => r.status !== "created").map((r) => r.email).join("\n"));
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  /** A failed row's reason in words: the known refusals translated, the
   * gateway's own text otherwise. */
  function reason(r: BulkInviteResult): string {
    const reasons: Record<string, string> = messages.people.invites.reasons;
    if (r.reason && Object.hasOwn(reasons, r.reason)) return reasons[r.reason];
    return r.error ?? t("people.invites.failed");
  }

  const created = results?.filter((r) => r.status === "created").length ?? 0;

  return (
    <section className={cardClass} aria-labelledby={headingId}>
      <h2 id={headingId} className={headingClass}>
        <Icon name="users" size={17} className="text-indigo-500 dark:text-indigo-400" />
        {t("people.invites.bulkHeading")}
      </h2>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div>
          <label htmlFor={listId} className={labelClass}>
            {t("people.invites.bulkLabel")}
          </label>
          <textarea
            id={listId}
            className={`${inputClass} min-h-28 font-mono`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
            aria-describedby={hintId}
            placeholder={t("people.invites.bulkPlaceholder")}
          />
          <p id={hintId} className={fieldHintClass}>
            {t("people.invites.bulkHint", { max: BULK_INVITE_MAX })}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor={fileId} className={labelClass}>
              {t("people.invites.upload")}
            </label>
            <input
              id={fileId}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              onChange={onFile}
              disabled={busy}
              className="text-sm text-gray-700 dark:text-gray-300"
            />
          </div>
          <div>
            <label htmlFor={roleId} className={labelClass}>
              {t("people.role")}
            </label>
            <RoleSelect id={roleId} value={role} onChange={setRole} disabled={busy} />
          </div>
        </div>
        <p className={mutedTextClass} aria-live="polite">
          {plural("people.invites.ready", emails.length)}
          {invalid.length > 0 && <> {t("people.invites.invalid", { list: invalid.join(", ") })}</>}
        </p>
        <div>
          <button type="submit" disabled={busy || emails.length === 0} className={primaryButtonClass}>
            <Icon name="send" size={16} />
            {busy ? t("common.sending") : plural("people.invites.bulkSubmit", emails.length)}
          </button>
        </div>
        {error && <StatusLine isError>{error}</StatusLine>}
      </form>

      {results && (
        <div className="mt-4">
          <p role="status" className="mb-2 text-sm font-medium text-gray-900 dark:text-gray-100">
            {t("people.invites.summary", { created, failed: results.length - created })}
          </p>
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t("people.invites.resultsCaption")}</caption>
            <thead className="text-xs text-gray-500 dark:text-gray-400">
              <tr>
                <th scope="col" className="py-1 pr-3 font-medium">
                  {t("people.invites.email")}
                </th>
                <th scope="col" className="py-1 font-medium">
                  {t("people.invites.result")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {results.map((r) => (
                <tr key={r.email}>
                  <td className="py-1.5 pr-3 font-mono text-xs">{r.email}</td>
                  <td className="py-1.5">
                    {r.status === "created" ? (
                      <span className={`${badgeBaseClass} ${badgeTone.success}`}>{t("people.invites.created")}</span>
                    ) : (
                      <span className="text-red-700 dark:text-red-400">{reason(r)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
