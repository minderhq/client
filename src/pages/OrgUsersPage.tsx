import { useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { LoadError } from "../components/LoadError";
import { PeopleHeader } from "../components/PeopleHeader";
import { ResetPasswordControl } from "../components/ResetPasswordControl";
import { Skeleton } from "../components/Skeleton";
import { StatusLine } from "../components/StatusLine";
import { useI18n } from "../i18n";
import { useAuth } from "../lib/auth";
import { filterByText } from "../lib/filterByText";
import {
  type DirectoryUser,
  fetchAllUsers,
  ORG_ROLES,
  type OrgMember,
  orgMemberErrorMessage,
  orgMemberResetPasswordPath,
  orgRoleTone,
} from "../lib/orgs";
import { personRoute, ROUTES } from "../lib/routes";
import {
  badgeClass,
  badgeTone,
  cardClass,
  inputClass,
  mutedTextClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../lib/ui";
import { useAsyncResource } from "../lib/useAsyncResource";
import { useMemberActions, usePeopleData, useRoleLabel } from "../lib/usePeople";

/** Where a member whose password can't be reset from here gets a new one. */
const SELF_SERVICE_RESET_PATH = "/forgot-password";

/** Organization › People › Members (UX step 7): the active org's members
 * with their role, teams and status, searchable, each linking to their
 * person page. Org-level actions (role, suspend, remove) follow the caller's
 * permissions in this org; account-level ones (password reset, deactivate)
 * only the members the API marks as the caller's to manage. Every call goes
 * to the org-scoped member routes; the installation-wide account routes
 * belong to the Platform Admin's All users. */
export function OrgUsersPage() {
  const { token, sessionKey, userId, isPlatformAdmin } = useAuth();
  const { t, plural } = useI18n();
  const roleLabel = useRoleLabel();
  const addUserId = useId();
  const addRoleId = useId();
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [addTarget, setAddTarget] = useState("");
  const [addRole, setAddRole] = useState("member");

  const { orgsRes, active, membersRes, rolesRes, canManage, canSuspend } = usePeopleData();
  const actions = useMemberActions(
    active,
    rolesRes.data ?? [],
    (m) => ({
      roles: [roleLabel(m.org_role)],
      teams: (m.teams ?? []).map((team) => team.name),
    }),
    membersRes.reload,
  );

  // Adding an EXISTING account by picking it needs the installation-wide
  // directory, which only a Platform Admin can read. Everyone else invites.
  const usersRes = useAsyncResource<DirectoryUser[]>(
    (signal) => fetchAllUsers(token, signal).then((r) => r.users),
    { deps: [sessionKey], enabled: isPlatformAdmin === true },
  );
  const members = useMemo(() => membersRes.data ?? [], [membersRes.data]);
  const memberIds = useMemo(() => new Set(members.map((m) => m.user_id)), [members]);
  const addableUsers = (usersRes.data ?? []).filter((u) => !memberIds.has(u.id));
  const shown = filterByText(members, query, (m) => [m.username, m.email]);

  async function handleAdd() {
    if (!addTarget) return;
    await actions.add(Number(addTarget), addRole);
    setAddTarget("");
    setAddRole("member");
  }

  return (
    <>
      {actions.dialog}
      <PeopleHeader
        title={t("nav.items.people.title")}
        subtitle={active ? t("people.subtitle", { org: active.name }) : undefined}
      />

      {orgsRes.error && (
        <LoadError
          title={t("people.orgLoadError")}
          message={orgsRes.error}
          onRetry={orgsRes.reload}
          what={t("nav.items.people.title")}
        />
      )}
      {orgsRes.data && !active && <EmptyState>{t("people.noOrg")}</EmptyState>}

      {active && (
        <section className={cardClass}>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div className="min-w-48 flex-1">
              <label htmlFor={searchId} className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                {t("people.members.search")}
              </label>
              <input
                id={searchId}
                type="search"
                className={inputClass}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("people.members.searchPlaceholder")}
              />
            </div>
            <div className="flex items-center gap-3">
              {isPlatformAdmin && (
                <Link
                  to={ROUTES.allUsers}
                  className="flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  {t("people.members.allUsers")}
                  <Icon name="arrow" size={14} />
                </Link>
              )}
              {canManage && (
                <Link to={ROUTES.peopleInvites} className={primaryButtonClass}>
                  <Icon name="mail" size={16} />
                  {t("people.members.invite")}
                </Link>
              )}
              <button type="button" onClick={membersRes.reload} className={secondaryButtonClass}>
                <Icon name="reset" size={15} /> {t("people.members.refresh")}
              </button>
            </div>
          </div>

          {isPlatformAdmin && (
            <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950/40">
              <div className="min-w-48 flex-1">
                <label htmlFor={addUserId} className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                  {t("people.members.addLabel")}
                </label>
                <select
                  id={addUserId}
                  className={inputClass}
                  value={addTarget}
                  onChange={(e) => setAddTarget(e.target.value)}
                  disabled={actions.busy}
                >
                  <option value="">{t("people.members.addChoose")}</option>
                  {addableUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.username} ({u.email})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={addRoleId} className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                  {t("people.role")}
                </label>
                <select
                  id={addRoleId}
                  className={inputClass}
                  value={addRole}
                  onChange={(e) => setAddRole(e.target.value)}
                  disabled={actions.busy}
                >
                  {ORG_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={handleAdd}
                disabled={actions.busy || !addTarget}
                className={primaryButtonClass}
              >
                <Icon name="plus" size={16} />
                {t("people.members.addSubmit")}
              </button>
            </div>
          )}

          <StatusLine isError={actions.isError}>{actions.status}</StatusLine>

          {membersRes.error ? (
            <LoadError
              title={t("people.members.loadError")}
              message={membersRes.error}
              onRetry={membersRes.reload}
              what={t("nav.items.people.title")}
            />
          ) : membersRes.loading && !membersRes.data ? (
            <div aria-busy="true" className="flex flex-col gap-2">
              <span className="sr-only">{t("common.loading")}</span>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : members.length === 0 ? (
            <EmptyState>{t("people.members.empty")}</EmptyState>
          ) : shown.length === 0 ? (
            <EmptyState>{t("people.members.noMatch", { query })}</EmptyState>
          ) : (
            <>
              <p className="sr-only" role="status">
                {plural("people.members.count", shown.length)}
              </p>
              <ul className="flex flex-col divide-y divide-gray-100 dark:divide-gray-800">
                {shown.map((m) => (
                  <MemberRow
                    key={m.user_id}
                    member={m}
                    orgId={active.id}
                    token={token}
                    isSelf={String(m.user_id) === userId}
                    canManage={canManage}
                    canSuspend={canSuspend}
                    busy={actions.busy}
                    onRoleChange={(r) => actions.changeRole(m, r)}
                    onRemove={() => actions.remove(m)}
                    onSuspend={() => actions.toggleSuspend(m)}
                    onAccountActive={() => actions.toggleAccountActive(m)}
                  />
                ))}
              </ul>
            </>
          )}

          <p className={`mt-3 ${mutedTextClass}`}>
            {canManage || canSuspend ? t("people.members.footerManage") : t("people.members.footerView")}
          </p>
        </section>
      )}
    </>
  );
}

/** The member's state as badges: home org, suspended, deactivated, a
 * pending password change, outside the allowed email domains. */
export function MemberBadges({ member: m }: { member: OrgMember }) {
  const { t } = useI18n();
  return (
    <>
      {m.is_home && <span className={badgeClass}>{t("people.badges.home")}</span>}
      {m.suspended_at && <span className={`${badgeClass} ${badgeTone.warn}`}>{t("people.badges.suspended")}</span>}
      {!m.is_active && <span className={`${badgeClass} ${badgeTone.danger}`}>{t("people.badges.deactivated")}</span>}
      {m.must_change_password && <span className={badgeClass}>{t("people.badges.mustChange")}</span>}
      {m.outside_allowed_domains && (
        <span className={`${badgeClass} ${badgeTone.warn}`}>{t("people.badges.outsideDomains")}</span>
      )}
    </>
  );
}

function MemberRow({
  member: m,
  orgId,
  token,
  isSelf,
  canManage,
  canSuspend,
  busy,
  onRoleChange,
  onRemove,
  onSuspend,
  onAccountActive,
}: {
  member: OrgMember;
  orgId: number;
  token: string;
  isSelf: boolean;
  canManage: boolean;
  canSuspend: boolean;
  busy: boolean;
  onRoleChange: (role: string) => void;
  onRemove: () => void;
  onSuspend: () => void;
  onAccountActive: () => void;
}) {
  const { t, rich } = useI18n();
  const roleLabel = useRoleLabel();
  // Account-level actions follow the API's per-member flags, never the
  // caller's role: an account that also belongs to another organization is
  // not this org's to reset or deactivate.
  const canReset = !isSelf && m.resettable_by_caller;
  const canDeactivate = !isSelf && m.managed_by_caller;
  // An admin who can't reset this account here is pointed at email
  // self-service instead (or told that single sign-on manages it).
  const showResetHint = canManage && !isSelf && !m.resettable_by_caller;

  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
        <Icon name="user" size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-gray-100">
          <Link to={personRoute(m.user_id)} className="truncate hover:underline">
            {m.username}
          </Link>
          <MemberBadges member={m} />
        </span>
        <span className="block truncate text-xs text-gray-500 dark:text-gray-400">{m.email}</span>
        {m.teams && (
          <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
            {m.teams.length > 0
              ? t("people.members.teams", { teams: m.teams.map((team) => team.name).join(", ") })
              : t("people.members.noTeams")}
          </span>
        )}
        {showResetHint && (
          <span className="block text-xs text-gray-500 dark:text-gray-400">
            {m.is_oidc_linked
              ? t("people.members.resetSso")
              : rich("people.members.resetHint", {
                  link: (
                    <Link
                      to={SELF_SERVICE_RESET_PATH}
                      className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      {t("people.members.resetLink", { name: m.username })}
                    </Link>
                  ),
                })}
          </span>
        )}
      </span>

      <div className="flex flex-wrap items-center gap-2">
        {canManage ? (
          <select
            className="w-32 shrink-0 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            value={m.org_role}
            disabled={busy}
            aria-label={t("people.members.roleFor", { name: m.username })}
            onChange={(e) => onRoleChange(e.target.value)}
          >
            {ORG_ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
        ) : (
          <span className={`${badgeClass} ${orgRoleTone(m.org_role)}`}>{roleLabel(m.org_role)}</span>
        )}
        {canSuspend && !isSelf && (
          <button
            type="button"
            onClick={onSuspend}
            disabled={busy}
            className={`${secondaryButtonClass} shrink-0`}
            title={m.suspended_at ? t("people.actions.unsuspendHint") : t("people.actions.suspendHint")}
          >
            {m.suspended_at ? t("people.actions.unsuspend") : t("people.actions.suspend")}
          </button>
        )}
        {canReset && (
          <ResetPasswordControl
            username={m.username}
            endpoint={orgMemberResetPasswordPath(orgId, m.user_id)}
            token={token}
            formatError={orgMemberErrorMessage}
          />
        )}
        {canDeactivate && (
          <button
            type="button"
            onClick={onAccountActive}
            disabled={busy}
            className={`${secondaryButtonClass} shrink-0`}
            title={m.is_active ? t("people.actions.deactivateHint") : t("people.actions.reactivateHint")}
          >
            {m.is_active ? t("people.actions.deactivate") : t("people.actions.reactivate")}
          </button>
        )}
        {canManage && (
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            className={`${secondaryButtonClass} shrink-0 text-red-600 dark:text-red-400`}
            title={t("people.actions.removeHint")}
            aria-label={t("people.actions.removeName", { name: m.username })}
          >
            <Icon name="delete" size={15} />
            <span className="hidden sm:inline">{t("people.actions.remove")}</span>
          </button>
        )}
      </div>
    </li>
  );
}
