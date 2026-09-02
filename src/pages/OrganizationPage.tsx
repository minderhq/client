import { useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useConfirm } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { InfoCallout } from "../components/InfoCallout";
import { PageHeader } from "../components/PageHeader";
import { StatusLine } from "../components/StatusLine";
import { friendlyErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { copyText } from "../lib/browser";
import {
  createOrgInvite,
  type DirectoryUser,
  fetchAllUsers,
  fetchMyOrgs,
  fetchOrgInvites,
  fetchOrgMembers,
  type MyOrg,
  type OrgInvite,
  ORG_ROLES,
  orgRoleTone,
  removeOrgMember,
  revokeOrgInvite,
  setOrgMember,
} from "../lib/orgs";
import {
  badgeClass,
  cardClass,
  inputClass,
  mutedTextClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../lib/ui";
import { useAsyncResource } from "../lib/useAsyncResource";

/** The Organization home: which org you're acting in, who's in it and their
 * roles, and — for an admin — adding members, changing their org role, and
 * removing them. Together with the topbar OrgSwitcher this is where multi-org
 * membership becomes legible and manageable: a user can be owner of one org and
 * admin of another, and both appear here / in the switcher. Team-level
 * membership stays on the Teams page (linked). */
export function OrganizationPage() {
  const { isAuthenticated, token, role, activeTenantId, orgRole } = useAuth();
  const isAdmin = role === "admin";
  // #1208: an org owner/admin manages their OWN org's members too — role change
  // + removal need no user directory. Adding a brand-new member still needs the
  // instance-admin-only user directory, so that section stays isAdmin-gated.
  const canManage = isAdmin || orgRole === "owner" || orgRole === "admin";
  const { confirm, dialog } = useConfirm();
  const addUserId = useId();
  const addRoleId = useId();

  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addTarget, setAddTarget] = useState("");
  const [addRole, setAddRole] = useState("member");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const inviteEmailId = useId();
  const inviteRoleId = useId();

  const orgsRes = useAsyncResource<MyOrg[]>(
    (signal) => fetchMyOrgs(token, signal).then((r) => r.organizations),
    { deps: [token], enabled: isAuthenticated },
  );

  const activeId = activeTenantId ? Number(activeTenantId) : null;
  const orgs = orgsRes.data ?? [];
  const active =
    orgs.find((o) => o.id === activeId) ?? orgs.find((o) => o.is_home) ?? orgs[0];

  const membersRes = useAsyncResource(
    (signal) =>
      active
        ? fetchOrgMembers(active.id, token, signal).then((r) => r.members)
        : Promise.resolve([]),
    { deps: [token, active?.id], enabled: isAuthenticated && !!active },
  );

  // Directory for the add-member picker — admin-only endpoint, so only fetch it
  // when the caller can actually add members.
  const usersRes = useAsyncResource<DirectoryUser[]>(
    (signal) => fetchAllUsers(token, signal).then((r) => r.users),
    { deps: [token], enabled: isAuthenticated && isAdmin },
  );

  // Pending/spent org invites — owner/admin only (same gate as the endpoint).
  const invitesRes = useAsyncResource<OrgInvite[]>(
    (signal) =>
      active
        ? fetchOrgInvites(active.id, token, signal).then((r) => r.invites)
        : Promise.resolve([]),
    { deps: [token, active?.id], enabled: isAuthenticated && canManage && !!active },
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
      report(friendlyErrorMessage(e), true);
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

  async function handleInvite() {
    if (!active || !inviteEmail.trim()) return;
    setBusy(true);
    report("Sending invite…");
    try {
      await createOrgInvite(
        active.id,
        { email: inviteEmail.trim(), org_role: inviteRole },
        token,
      );
      await invitesRes.reload();
      report(`Invite sent to ${inviteEmail.trim()}.`);
      setInviteEmail("");
      setInviteRole("member");
    } catch (e) {
      report(friendlyErrorMessage(e), true);
    } finally {
      setBusy(false);
    }
  }

  async function handleRevokeInvite(inviteId: number, email: string) {
    if (!active) return;
    const ok = await confirm({
      title: "Revoke invite?",
      message: `Revoke the pending invite for ${email}? Its link will stop working.`,
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    report("Revoking…");
    try {
      await revokeOrgInvite(active.id, inviteId, token);
      await invitesRes.reload();
      report("Invite revoked.");
    } catch (e) {
      report(friendlyErrorMessage(e), true);
    } finally {
      setBusy(false);
    }
  }

  async function handleRoleChange(userId: number, newRole: string) {
    if (!active) return;
    await runMutation(
      () => setOrgMember(active.id, userId, newRole, token),
      "Role updated.",
    );
  }

  async function handleRemove(userId: number, username: string) {
    if (!active) return;
    const ok = await confirm({
      title: "Remove member?",
      message: `Remove ${username} from ${active.name}? They keep their account but lose access to this organization's resources.`,
      danger: true,
    });
    if (!ok) return;
    await runMutation(
      () => removeOrgMember(active.id, userId, token),
      "Member removed.",
    );
  }

  if (!isAuthenticated) {
    return (
      <>
        <PageHeader
          icon="org"
          title="Organization"
          subtitle="Your organization, its members, and switching between the orgs you belong to."
        />
        <InfoCallout icon="lock">Log in to view your organization.</InfoCallout>
      </>
    );
  }

  return (
    <>
      {dialog}
      <PageHeader
        icon="org"
        title="Organization"
        subtitle="Your organization, its members, and switching between the orgs you belong to."
      />

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
        <>
          {/* Which org am I in right now. */}
          <section className={`mb-4 ${cardClass}`}>
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100 dark:bg-indigo-950/50 dark:text-indigo-300 dark:ring-indigo-900">
                <Icon name="org" size={22} />
              </span>
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
                  {active.name}
                  {active.is_home && <span className={badgeClass}>home</span>}
                </h2>
                <p className={`mt-0.5 ${mutedTextClass}`}>
                  <code>{active.slug}</code> · you are{" "}
                  <span className={`${badgeClass} ${orgRoleTone(orgRole || active.org_role)}`}>
                    {orgRole || active.org_role}
                  </span>{" "}
                  here
                </p>
              </div>
            </div>
            {orgs.length > 1 && (
              <p className={`mt-3 ${mutedTextClass}`}>
                You belong to {orgs.length} organizations — use the{" "}
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  organization switcher
                </span>{" "}
                in the top bar to change which one you're working in.
              </p>
            )}
          </section>

          {/* Members of the active org (+ admin management). */}
          <section className={cardClass}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
                <Icon name="users" size={17} className="text-indigo-500 dark:text-indigo-400" />
                Members
              </h2>
              <Link
                to="/platform/teams"
                className="flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Manage teams
                <Icon name="arrow" size={14} />
              </Link>
            </div>

            {isAdmin && (
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
                {friendlyErrorMessage(membersRes.error)}
              </p>
            ) : membersRes.loading && !membersRes.data ? (
              <p className={mutedTextClass}>Loading members…</p>
            ) : (membersRes.data?.length ?? 0) === 0 ? (
              <EmptyState>No members found.</EmptyState>
            ) : (
              <ul className="flex flex-col divide-y divide-gray-100 dark:divide-gray-800">
                {membersRes.data?.map((m) => (
                  <li key={m.user_id} className="flex items-center gap-3 py-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                      <Icon name="user" size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                        {m.username}
                      </span>
                      <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                        {m.email}
                      </span>
                    </span>
                    {m.is_home && <span className={badgeClass}>home</span>}
                    {canManage ? (
                      <>
                        <select
                          className="w-28 shrink-0 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                          value={m.org_role}
                          disabled={busy}
                          aria-label={`Role for ${m.username}`}
                          onChange={(e) => handleRoleChange(m.user_id, e.target.value)}
                        >
                          {ORG_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => handleRemove(m.user_id, m.username)}
                          disabled={busy}
                          className={`${secondaryButtonClass} shrink-0 text-red-600 dark:text-red-400`}
                          title="Remove from organization"
                        >
                          <Icon name="delete" size={15} />
                          <span className="hidden sm:inline">Remove</span>
                        </button>
                      </>
                    ) : (
                      <span className={`${badgeClass} ${orgRoleTone(m.org_role)}`}>
                        {m.org_role}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <p className={`mt-3 ${mutedTextClass}`}>
              {canManage
                ? "Changing a member's role takes effect on their next request; they may need to switch orgs or re-log in to see it. To bring in someone new, invite them by email below. Day-to-day sharing is done through Teams."
                : "Managing members and invites is an owner/admin action. Day-to-day sharing is done through Teams."}
            </p>
          </section>

          {/* Invite by email (#1209) — owner/admin can grow the org without the
            cross-tenant user directory the add-existing picker needs. */}
          {canManage && (
            <section className={`mt-4 ${cardClass}`}>
              <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
                <Icon name="mail" size={17} className="text-indigo-500 dark:text-indigo-400" />
                Invite by email
              </h2>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-52 flex-1">
                  <label htmlFor={inviteEmailId} className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                    Email address
                  </label>
                  <input
                    id={inviteEmailId}
                    type="email"
                    className={inputClass}
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    disabled={busy}
                    placeholder="person@example.com"
                  />
                </div>
                <div>
                  <label htmlFor={inviteRoleId} className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                    Role
                  </label>
                  <select
                    id={inviteRoleId}
                    className={inputClass}
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
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
                  onClick={handleInvite}
                  disabled={busy || !inviteEmail.trim()}
                  className={primaryButtonClass}
                >
                  <Icon name="mail" size={16} />
                  Send invite
                </button>
              </div>

              {(invitesRes.data?.length ?? 0) > 0 && (
                <ul className="mt-4 flex flex-col divide-y divide-gray-100 dark:divide-gray-800">
                  {invitesRes.data?.map((inv) => (
                    <li key={inv.id} className="flex items-center gap-3 py-2.5">
                      <Icon name="mail" size={16} className="shrink-0 text-gray-400" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                          {inv.email}
                        </span>
                        <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                          {inv.status}
                          {inv.max_uses > 1 ? ` · ${inv.uses}/${inv.max_uses} used` : ""}
                        </span>
                      </span>
                      {inv.org_role && (
                        <span className={`${badgeClass} ${orgRoleTone(inv.org_role)}`}>
                          {inv.org_role}
                        </span>
                      )}
                      {inv.status === "pending" && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              copyText(`${window.location.origin}/invite/${inv.token}`)
                            }
                            className={`${secondaryButtonClass} shrink-0`}
                            title="Copy the invite link to share"
                          >
                            <Icon name="copy" size={15} />
                            <span className="hidden sm:inline">Copy link</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRevokeInvite(inv.id, inv.email)}
                            disabled={busy}
                            className={`${secondaryButtonClass} shrink-0 text-red-600 dark:text-red-400`}
                            title="Revoke this invite"
                          >
                            <Icon name="close" size={15} />
                            <span className="hidden sm:inline">Revoke</span>
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className={`mt-3 ${mutedTextClass}`}>
                Share the copied link with the invitee. They log in (or register)
                with this email, then open the link to join {active.name}.
              </p>
            </section>
          )}
        </>
      )}
    </>
  );
}
