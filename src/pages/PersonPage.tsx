import { useId, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { InfoCallout } from "../components/InfoCallout";
import { LoadError } from "../components/LoadError";
import { PageHeader } from "../components/PageHeader";
import { Skeleton } from "../components/Skeleton";
import { StatusLine } from "../components/StatusLine";
import { useI18n } from "../i18n";
import { useAuth } from "../lib/auth";
import { ORG_ROLES, orgMemberErrorMessage, type OrgMember } from "../lib/orgs";
import {
  fetchMemberPermissions,
  fetchMemberRoles,
  grantMemberRole,
  type OrgRole,
  type PermissionEntry,
  revokeMemberRole,
  type RoleAssignment,
} from "../lib/people";
import { ROUTES } from "../lib/routes";
import {
  badgeClass,
  cardClass,
  destructiveButtonClass,
  inputClass,
  mutedTextClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../lib/ui";
import { useAsyncResource } from "../lib/useAsyncResource";
import { useCan } from "../lib/useCan";
import { useMemberActions, usePeopleData, usePermissionName, useRoleLabel } from "../lib/usePeople";
import { MemberBadges } from "./OrgUsersPage";

const headingClass = "mb-3 text-base font-semibold text-gray-900 dark:text-gray-100";
const labelClass = "mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300";

/** Organization › People › one person (access-control §6.1, Phase 1): their
 * roles and where each permission comes from, their teams, and suspend or
 * remove behind a confirmation that lists what they lose. Custom roles that
 * already exist can be given (optionally until a date) and taken away;
 * editing roles themselves is a later phase. */
export function PersonPage() {
  const { userId: param } = useParams();
  const uid = Number(param);
  const { token, sessionKey, userId } = useAuth();
  const { t } = useI18n();
  // Organization › Teams is gated on org.teams.manage, this page on
  // org.members.manage: link the teams only for callers who may open it.
  const canManageTeams = useCan("org.teams.manage");
  const roleLabel = useRoleLabel();
  const { orgsRes, active, membersRes, rolesRes, canManage, canSuspend } = usePeopleData();
  const member = membersRes.data?.find((m) => m.user_id === uid);
  const roles = rolesRes.data ?? [];

  const grantsRes = useAsyncResource<RoleAssignment[]>(
    (signal) => fetchMemberRoles(active!.id, uid, token, signal).then((r) => r.assignments),
    { deps: [sessionKey, active?.id, uid], enabled: !!active && !!member },
  );
  const permsRes = useAsyncResource<PermissionEntry[]>(
    (signal) => fetchMemberPermissions(active!.id, uid, token, signal).then((r) => r.permissions),
    { deps: [sessionKey, active?.id, uid], enabled: !!active && !!member },
  );
  const teams = member?.teams ?? [];
  const systemIds = new Set(roles.filter((r) => r.is_system).map((r) => r.id));
  const customGrants = (grantsRes.data ?? []).filter(
    (g) => !systemIds.has(g.role_id) && !(ORG_ROLES as readonly string[]).includes(g.role_name),
  );

  function reloadAll() {
    membersRes.reload();
    grantsRes.reload();
    permsRes.reload();
  }
  const actions = useMemberActions(
    active,
    roles,
    (m) => ({
      roles: [roleLabel(m.org_role), ...customGrants.map((g) => g.role_name)],
      teams: teams.map((team) => team.name),
    }),
    reloadAll,
  );

  const back = (
    <Link
      to={ROUTES.people}
      className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
    >
      <Icon name="arrow" size={14} className="rotate-180" />
      {t("people.person.back")}
    </Link>
  );

  if (orgsRes.error || membersRes.error) {
    return (
      <>
        {back}
        <LoadError
          title={t("people.members.loadError")}
          message={orgsRes.error ?? membersRes.error}
          onRetry={orgsRes.error ? orgsRes.reload : membersRes.reload}
          what={t("nav.items.orgUsers.label")}
        />
      </>
    );
  }
  if (!membersRes.data) {
    return (
      <>
        {back}
        <div aria-busy="true">
          <span className="sr-only">{t("common.loading")}</span>
          <Skeleton className="h-40 w-full" />
        </div>
      </>
    );
  }
  if (!member || !active) {
    return (
      <>
        {back}
        <PageHeader icon="user" title={t("people.person.notFoundTitle")} />
        <EmptyState>{t("people.person.notFound")}</EmptyState>
      </>
    );
  }

  const isSelf = String(member.user_id) === userId;
  return (
    <>
      {actions.dialog}
      {back}
      <PageHeader icon="user" title={member.username} subtitle={member.email} />
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <MemberBadges member={member} />
      </div>
      <StatusLine isError={actions.isError}>{actions.status}</StatusLine>

      <section className={`mb-4 ${cardClass}`} aria-labelledby="person-roles">
        <h2 id="person-roles" className={headingClass}>
          {t("people.person.rolesHeading")}
        </h2>
        <RolesSection
          member={member}
          orgId={active.id}
          roles={roles}
          grants={grantsRes.data}
          grantsError={grantsRes.error}
          customGrants={customGrants}
          canManage={canManage}
          busy={actions.busy}
          onRoleChange={(role) => actions.changeRole(member, role)}
          onChanged={reloadAll}
        />
      </section>

      <section className={`mb-4 ${cardClass}`} aria-labelledby="person-perms">
        <h2 id="person-perms" className={headingClass}>
          {t("people.person.permsHeading")}
        </h2>
        {permsRes.error ? (
          <LoadError
            quiet
            title={t("people.person.permsLoadError")}
            message={permsRes.error}
            onRetry={permsRes.reload}
            what={t("people.person.permsHeading")}
          />
        ) : !permsRes.data ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <PermissionList entries={permsRes.data} />
        )}
      </section>

      {member.teams && (
        <section className={`mb-4 ${cardClass}`} aria-labelledby="person-teams">
          <h2 id="person-teams" className={headingClass}>
            {t("people.person.teamsHeading")}
          </h2>
          {teams.length === 0 ? (
            <EmptyState>{t("people.person.teamsEmpty")}</EmptyState>
          ) : (
            <ul className="flex flex-col gap-1">
              {teams.map((team) => (
                <li key={team.id} className="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100">
                  {canManageTeams ? (
                    <Link to={ROUTES.orgTeams} className="hover:underline">
                      {team.name}
                    </Link>
                  ) : (
                    team.name
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!isSelf && (canSuspend || canManage) && (
        <section
          className={`${cardClass} border-red-200 dark:border-red-900`}
          aria-labelledby="person-access"
        >
          <h2 id="person-access" className={headingClass}>
            {t("people.person.accessHeading")}
          </h2>
          <p className={`mb-3 ${mutedTextClass}`}>{t("people.person.accessHint", { org: active.name })}</p>
          <div className="flex flex-wrap gap-2">
            {canSuspend && (
              <button
                type="button"
                className={secondaryButtonClass}
                disabled={actions.busy}
                onClick={() => actions.toggleSuspend(member)}
              >
                {member.suspended_at ? t("people.actions.unsuspend") : t("people.actions.suspend")}
              </button>
            )}
            {canManage && (
              <button
                type="button"
                className={destructiveButtonClass}
                disabled={actions.busy}
                onClick={() => actions.remove(member)}
              >
                <Icon name="delete" size={15} />
                {t("people.actions.remove")}
              </button>
            )}
          </div>
        </section>
      )}
    </>
  );
}

/** Each permission once, with every role (and group, or parent
 * organization) it comes from. */
function PermissionList({ entries }: { entries: PermissionEntry[] }) {
  const { t } = useI18n();
  const permissionName = usePermissionName();
  const roleLabel = useRoleLabel();
  if (entries.length === 0) return <EmptyState>{t("people.person.permsEmpty")}</EmptyState>;
  const byKey = new Map<string, string[]>();
  for (const e of entries) {
    const role = roleLabel(e.role_name ?? String(e.role_id));
    const source =
      e.via_ancestor_organization_id != null
        ? t("people.person.fromParent", { role })
        : e.permission_group_name
          ? t("people.person.fromGroup", { role, group: e.permission_group_name })
          : t("people.person.fromRole", { role });
    const sources = byKey.get(e.permission_key) ?? [];
    if (!sources.includes(source)) sources.push(source);
    byKey.set(e.permission_key, sources);
  }
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {[...byKey].sort(([a], [b]) => a.localeCompare(b)).map(([key, sources]) => (
        <li key={key} className="flex flex-wrap gap-x-2 text-gray-900 dark:text-gray-100">
          <span>{permissionName(key)}</span>
          <span className="text-gray-500 dark:text-gray-400">{sources.join(" · ")}</span>
        </li>
      ))}
    </ul>
  );
}

function RolesSection({
  member,
  orgId,
  roles,
  grants,
  grantsError,
  customGrants,
  canManage,
  busy,
  onRoleChange,
  onChanged,
}: {
  member: OrgMember;
  orgId: number;
  roles: OrgRole[];
  grants: RoleAssignment[] | null;
  grantsError: string | null;
  customGrants: RoleAssignment[];
  canManage: boolean;
  busy: boolean;
  onRoleChange: (role: string) => void;
  onChanged: () => void;
}) {
  const { token } = useAuth();
  const { t, formatDate } = useI18n();
  const roleLabel = useRoleLabel();
  const orgRoleId = useId();
  const grantRoleId = useId();
  const untilId = useId();
  const [grantRole, setGrantRole] = useState("");
  const [until, setUntil] = useState("");
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [working, setWorking] = useState(false);

  const held = new Set(customGrants.map((g) => g.role_id));
  const grantable = roles.filter((r) => !r.is_system && !held.has(r.id));

  async function run(fn: () => Promise<unknown>, ok: string): Promise<boolean> {
    setWorking(true);
    setIsError(false);
    try {
      await fn();
      onChanged();
      setStatus(ok);
      return true;
    } catch (e) {
      setStatus(orgMemberErrorMessage(e));
      setIsError(true);
      return false;
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {canManage ? (
          <label htmlFor={orgRoleId} className="text-sm text-gray-700 dark:text-gray-300">
            {t("people.person.orgRole")}
          </label>
        ) : (
          <span className="text-sm text-gray-700 dark:text-gray-300">{t("people.person.orgRole")}</span>
        )}
        {canManage ? (
          <select
            id={orgRoleId}
            className={`${inputClass} w-40`}
            value={member.org_role}
            disabled={busy}
            onChange={(e) => onRoleChange(e.target.value)}
          >
            {ORG_ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
        ) : (
          <span className={badgeClass}>
            {roleLabel(member.org_role)}
          </span>
        )}
        <span className={mutedTextClass}>{t("people.person.direct")}</span>
      </div>

      {grantsError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{grantsError}</p>
      ) : grants === null ? (
        <Skeleton className="h-8 w-full" />
      ) : customGrants.length > 0 ? (
        <ul className="mb-3 flex flex-col gap-1">
          {customGrants.map((g) => (
            <li key={g.role_id} className="flex flex-wrap items-center gap-2 text-sm text-gray-900 dark:text-gray-100">
              <span className="font-medium">{g.role_name}</span>
              <span className={mutedTextClass}>
                {t("people.person.direct")}
                {g.is_expired
                  ? ` · ${t("people.person.expired")}`
                  : g.expires_at
                    ? ` · ${t("people.person.until", { date: formatDate(g.expires_at, { dateStyle: "medium" }) })}`
                    : ""}
              </span>
              {canManage && (
                <button
                  type="button"
                  className={`${secondaryButtonClass} px-2 py-1 text-xs`}
                  disabled={working}
                  onClick={() =>
                    run(() => revokeMemberRole(orgId, member.user_id, g.role_id, token), t("people.person.revoked"))
                  }
                  aria-label={t("people.person.revokeRole", { role: g.role_name })}
                >
                  {t("people.person.revoke")}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {canManage &&
        (grantable.length === 0 ? (
          customGrants.length === 0 && <p className={mutedTextClass}>{t("people.person.noCustomRoles")}</p>
        ) : (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!grantRole) return;
              const expires = until ? new Date(`${until}T23:59:59`).toISOString() : null;
              void run(
                () => grantMemberRole(orgId, member.user_id, Number(grantRole), expires, token),
                t("people.person.granted"),
              ).then((done) => {
                if (!done) return;
                setGrantRole("");
                setUntil("");
              });
            }}
          >
            <div>
              <label htmlFor={grantRoleId} className={labelClass}>
                {t("people.person.grantRole")}
              </label>
              <select
                id={grantRoleId}
                className={inputClass}
                value={grantRole}
                onChange={(e) => setGrantRole(e.target.value)}
                disabled={working}
              >
                <option value="">{t("people.person.chooseRole")}</option>
                {grantable.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={untilId} className={labelClass}>
                {t("people.person.grantUntil")}
              </label>
              <input
                id={untilId}
                type="date"
                className={inputClass}
                value={until}
                onChange={(e) => setUntil(e.target.value)}
                disabled={working}
              />
            </div>
            <button type="submit" className={primaryButtonClass} disabled={working || !grantRole}>
              {t("people.person.grant")}
            </button>
          </form>
        ))}
      <StatusLine isError={isError} className="mb-0 mt-2">
        {status}
      </StatusLine>
      <div className="mt-3">
        <InfoCallout icon="info">{t("people.person.teamRolesNote")}</InfoCallout>
      </div>
    </>
  );
}
