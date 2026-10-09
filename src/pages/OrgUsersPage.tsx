import { useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useConfirm } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { InfoCallout } from "../components/InfoCallout";
import { PageHeader } from "../components/PageHeader";
import { ResetPasswordControl } from "../components/ResetPasswordControl";
import { StatusLine } from "../components/StatusLine";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  type DirectoryUser,
  fetchAllUsers,
  fetchMyOrgPermissions,
  fetchMyOrgs,
  fetchOrgMembers,
  type MyOrg,
  ORG_PERMISSIONS,
  ORG_ROLES,
  type OrgMember,
  orgMemberErrorMessage,
  orgMemberResetPasswordPath,
  orgRoleTone,
  pickActiveOrg,
  removeOrgMember,
  setOrgMember,
  setOrgMemberAccountActive,
  setOrgMemberSuspended,
} from "../lib/orgs";
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

/** Why the member list couldn't load, in words. The list is gated on
 * permission to view members, so a plain 403 means exactly that (never a
 * logout); the caller's own pending password change gets its own message. */
function memberListErrorMessage(e: unknown): string {
  if (
    e instanceof ApiError &&
    e.status === 403 &&
    !e.message.includes("password_change_required")
  ) {
    return "You don't have permission to see this organization's members.";
  }
  return orgMemberErrorMessage(e);
}

/** Where a member whose password can't be reset from here gets a new one. */
const SELF_SERVICE_RESET_PATH = "/forgot-password";

/** What the caller may do on this page, from their resolved permissions in
 * the active org. If those can't be read, it falls back to the org role in
 * the token (owner/admin hold both permissions by default). Only decides which
 * controls to show: every action route checks again. */
function useOrgPermissions(orgId: number | undefined) {
  const { isAuthenticated, token, sessionKey, userId, orgRole, isPlatformAdmin } = useAuth();
  const permsRes = useAsyncResource<Set<string>>(
    (signal) =>
      orgId !== undefined && userId
        ? fetchMyOrgPermissions(orgId, userId, token, signal)
        : Promise.resolve(new Set<string>()),
    { deps: [sessionKey, orgId, userId], enabled: isAuthenticated && orgId !== undefined && !!userId },
  );
  const fallback = orgRole === "owner" || orgRole === "admin";
  const has = (key: string) =>
    isPlatformAdmin || (permsRes.data ? permsRes.data.has(key) : !!permsRes.error && fallback);
  return {
    canManage: has(ORG_PERMISSIONS.manage),
    canSuspend: has(ORG_PERMISSIONS.suspend),
  };
}

/** The Users page for the org the caller is acting in (topbar org switcher).
 * Org-level actions (role, suspend, remove) follow the caller's permissions in
 * this org; account-level actions (password reset, deactivate) appear only on
 * the members the API marks as managed by / resettable by the caller. Every
 * call goes to the org-scoped member routes: the installation-wide account
 * routes belong to the separate Platform Admin view (All Users). */
export function OrgUsersPage() {
  const { isAuthenticated, token, sessionKey, userId, activeTenantId, isPlatformAdmin } =
    useAuth();
  const { confirm, dialog } = useConfirm();
  const addUserId = useId();
  const addRoleId = useId();

  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addTarget, setAddTarget] = useState("");
  const [addRole, setAddRole] = useState("member");

  const orgsRes = useAsyncResource<MyOrg[]>(
    (signal) => fetchMyOrgs(token, signal).then((r) => r.organizations),
    { deps: [sessionKey], enabled: isAuthenticated },
  );
  const orgs = orgsRes.data ?? [];
  const active = pickActiveOrg(orgs, activeTenantId);

  const { canManage, canSuspend } = useOrgPermissions(active?.id);

  const membersRes = useAsyncResource<OrgMember[]>(
    (signal) =>
      active
        ? fetchOrgMembers(active.id, token, signal).then(
            (r) => r.members,
            (e: unknown) => {
              throw new Error(memberListErrorMessage(e));
            },
          )
        : Promise.resolve([]),
    { deps: [sessionKey, active?.id], enabled: isAuthenticated && !!active },
  );

  // Adding an EXISTING account by picking it needs the installation-wide user
  // directory, which only a Platform Admin can read. Everyone else brings
  // people in by invite (Organization overview).
  const usersRes = useAsyncResource<DirectoryUser[]>(
    (signal) => fetchAllUsers(token, signal).then((r) => r.users),
    { deps: [sessionKey], enabled: isAuthenticated && isPlatformAdmin === true },
  );

  const memberIds = useMemo(
    () => new Set((membersRes.data ?? []).map((m) => m.user_id)),
    [membersRes.data],
  );
  const addableUsers = (usersRes.data ?? []).filter((u) => !memberIds.has(u.id));

  function report(msg: string, err = false) {
    setStatus(msg);
    setIsError(err);
  }

  async function runMutation(fn: () => Promise<unknown>, okMsg: string) {
    if (!active) return;
    setBusy(true);
    report("Working…");
    try {
      await fn();
      await membersRes.reload();
      report(okMsg);
    } catch (e) {
      report(orgMemberErrorMessage(e), true);
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd() {
    if (!active || !addTarget) return;
    await runMutation(
      () => setOrgMember(active.id, Number(addTarget), addRole, token),
      "Member added.",
    );
    setAddTarget("");
    setAddRole("member");
  }

  async function handleRoleChange(m: OrgMember, newRole: string) {
    if (!active) return;
    await runMutation(
      () => setOrgMember(active.id, m.user_id, newRole, token),
      "Role updated.",
    );
  }

  async function handleRemove(m: OrgMember) {
    if (!active) return;
    const ok = await confirm({
      title: "Remove member?",
      message: `Remove ${m.username} from ${active.name}? They keep their account but lose access to this organization's resources.`,
      danger: true,
    });
    if (!ok) return;
    await runMutation(() => removeOrgMember(active.id, m.user_id, token), "Member removed.");
  }

  async function handleSuspend(m: OrgMember) {
    if (!active) return;
    const suspend = !m.suspended_at;
    if (suspend) {
      const ok = await confirm({
        title: `Suspend ${m.username}?`,
        message: `${m.username} loses access to ${active.name} until you restore it. Their account and any other organizations they belong to are not affected.`,
        confirmLabel: "Suspend",
        danger: true,
      });
      if (!ok) return;
    }
    await runMutation(
      () => setOrgMemberSuspended(active.id, m.user_id, suspend, token),
      suspend ? "Member suspended." : "Access restored.",
    );
  }

  async function handleAccountActive(m: OrgMember) {
    if (!active) return;
    const activate = !m.is_active;
    if (!activate) {
      const ok = await confirm({
        title: `Deactivate ${m.username}'s account?`,
        message: `${m.username} will no longer be able to sign in anywhere. Their data is kept, and you can reactivate the account at any time.`,
        confirmLabel: "Deactivate",
        danger: true,
      });
      if (!ok) return;
    }
    await runMutation(
      () => setOrgMemberAccountActive(active.id, m.user_id, activate, token),
      activate ? "Account reactivated." : "Account deactivated.",
    );
  }

  const header = (
    <PageHeader
      icon="users"
      title="Users"
      subtitle="The members of the organization you're working in: their roles, access to this organization, and — for accounts this organization manages — password resets and deactivation."
    />
  );

  if (!isAuthenticated) {
    return (
      <>
        {header}
        <InfoCallout icon="lock">Log in to view your organization's users.</InfoCallout>
      </>
    );
  }

  const members = membersRes.data ?? [];

  return (
    <>
      {dialog}
      {header}

      <StatusLine isError={!!orgsRes.error}>
        {orgsRes.error ?? (orgsRes.loading && !orgsRes.data ? "Loading…" : "")}
      </StatusLine>

      {orgsRes.data && orgs.length === 0 && (
        <EmptyState>
          You don't belong to any organization yet. Organizations are provisioned
          by an administrator.
        </EmptyState>
      )}

      {active && (
        <section className={cardClass}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
              <Icon name="users" size={17} className="text-indigo-500 dark:text-indigo-400" />
              Members of {active.name}
            </h2>
            <div className="flex items-center gap-3">
              {isPlatformAdmin && (
                <Link
                  to="/platform/users"
                  className="flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  All users (Platform Admin)
                  <Icon name="arrow" size={14} />
                </Link>
              )}
              <button
                type="button"
                onClick={membersRes.reload}
                className={secondaryButtonClass}
              >
                <Icon name="reset" size={15} /> Refresh
              </button>
            </div>
          </div>

          {isPlatformAdmin && (
            <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950/40">
              <div className="min-w-48 flex-1">
                <label htmlFor={addUserId} className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Add a member
                </label>
                <select
                  id={addUserId}
                  className={inputClass}
                  value={addTarget}
                  onChange={(e) => setAddTarget(e.target.value)}
                  disabled={busy}
                >
                  <option value="">Choose a user…</option>
                  {addableUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.username} ({u.email})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={addRoleId} className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Role
                </label>
                <select
                  id={addRoleId}
                  className={inputClass}
                  value={addRole}
                  onChange={(e) => setAddRole(e.target.value)}
                  disabled={busy}
                >
                  {ORG_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={handleAdd}
                disabled={busy || !addTarget}
                className={primaryButtonClass}
              >
                <Icon name="plus" size={16} />
                Add
              </button>
            </div>
          )}

          <StatusLine isError={isError}>{status}</StatusLine>

          {membersRes.error ? (
            <p className="text-sm text-red-600 dark:text-red-400">
              {membersRes.error}
            </p>
          ) : membersRes.loading && !membersRes.data ? (
            <p className={mutedTextClass}>Loading members…</p>
          ) : members.length === 0 ? (
            <EmptyState>No members found.</EmptyState>
          ) : (
            <ul className="flex flex-col divide-y divide-gray-100 dark:divide-gray-800">
              {members.map((m) => (
                <MemberRow
                  key={m.user_id}
                  member={m}
                  orgId={active.id}
                  token={token}
                  isSelf={String(m.user_id) === userId}
                  canManage={canManage}
                  canSuspend={canSuspend}
                  busy={busy}
                  onRoleChange={(r) => handleRoleChange(m, r)}
                  onRemove={() => handleRemove(m)}
                  onSuspend={() => handleSuspend(m)}
                  onAccountActive={() => handleAccountActive(m)}
                />
              ))}
            </ul>
          )}

          <p className={`mt-3 ${mutedTextClass}`}>
            {canManage || canSuspend ? (
              <>
                Suspending or removing a member only affects this organization.
                Resetting a password or deactivating an account is offered only
                for accounts this organization manages; anyone else can reset
                their own password by email from the sign-in page. To bring in
                someone new, send an invite from the{" "}
                <Link to="/organization" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                  Organization overview
                </Link>
                .
              </>
            ) : (
              "Managing members is an owner/admin action. Day-to-day sharing is done through Teams."
            )}
          </p>
        </section>
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
  // Account-level actions follow the API's per-member flags, never the
  // caller's role: an account that also belongs to another organization is
  // not this org's to reset or deactivate.
  const canReset = !isSelf && m.resettable_by_caller;
  const canDeactivate = !isSelf && m.managed_by_caller;
  // An admin who can't reset this account here is pointed at email
  // self-service instead (an SSO account's password lives with the identity
  // provider, so that hint names the provider instead).
  const showResetHint = canManage && !isSelf && !m.resettable_by_caller;

  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
        <Icon name="user" size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-gray-100">
          <span className="truncate">{m.username}</span>
          {m.is_home && <span className={badgeClass}>home</span>}
          {m.suspended_at && (
            <span className={`${badgeClass} ${badgeTone.warn}`}>suspended</span>
          )}
          {!m.is_active && (
            <span className={`${badgeClass} ${badgeTone.danger}`}>deactivated</span>
          )}
          {m.must_change_password && (
            <span className={badgeClass}>must change password</span>
          )}
        </span>
        <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
          {m.email}
        </span>
        {showResetHint && (
          <span className="block text-xs text-gray-500 dark:text-gray-400">
            {m.is_oidc_linked ? (
              "Password is managed by single sign-on."
            ) : (
              <>
                Password can't be reset here.{" "}
                <Link
                  to={SELF_SERVICE_RESET_PATH}
                  className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  {m.username} can reset it by email
                </Link>
                .
              </>
            )}
          </span>
        )}
      </span>

      <div className="flex flex-wrap items-center gap-2">
        {canManage ? (
          <select
            className="w-28 shrink-0 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            value={m.org_role}
            disabled={busy}
            aria-label={`Role for ${m.username}`}
            onChange={(e) => onRoleChange(e.target.value)}
          >
            {ORG_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        ) : (
          <span className={`${badgeClass} ${orgRoleTone(m.org_role)}`}>{m.org_role}</span>
        )}
        {canSuspend && !isSelf && (
          <button
            type="button"
            onClick={onSuspend}
            disabled={busy}
            className={`${secondaryButtonClass} shrink-0`}
            title={m.suspended_at ? "Restore access to this organization" : "Suspend access to this organization"}
          >
            {m.suspended_at ? "Unsuspend" : "Suspend"}
          </button>
        )}
        {canReset && (
          <ResetPasswordControl
            userId={m.user_id}
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
            title={m.is_active ? "Deactivate this account everywhere" : "Reactivate this account"}
          >
            {m.is_active ? "Deactivate" : "Reactivate"}
          </button>
        )}
        {canManage && (
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            className={`${secondaryButtonClass} shrink-0 text-red-600 dark:text-red-400`}
            title="Remove from organization"
          >
            <Icon name="delete" size={15} />
            <span className="hidden sm:inline">Remove</span>
          </button>
        )}
      </div>
    </li>
  );
}
