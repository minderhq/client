import { useEffect, useId, useState } from "react";
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
  fetchMyOrgs,
  fetchOrgInvites,
  type MyOrg,
  type OrgInvite,
  ORG_ROLES,
  ORG_USERS_PATH,
  orgRoleTone,
  pickActiveOrg,
  revokeOrgInvite,
  updateOrganization,
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

/** The Organization home: which org you're acting in, its details, and — for
 * an owner/admin — inviting people by email. Together with the topbar
 * OrgSwitcher this is where multi-org membership becomes legible: a user can be
 * owner of one org and admin of another, and both appear here / in the
 * switcher. The member list and its actions live on the org's Users page
 * (linked); team-level membership stays on the Teams page (linked). */
export function OrganizationPage() {
  const { isAuthenticated, token, sessionKey, role, activeTenantId, orgRole } = useAuth();
  const isAdmin = role === "admin";
  // An org owner/admin manages their OWN org's details and invites.
  const canManage = isAdmin || orgRole === "owner" || orgRole === "admin";
  const { confirm, dialog } = useConfirm();

  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const inviteEmailId = useId();
  const inviteRoleId = useId();

  // #1503: edit the active org's own name/description. A separate status/busy
  // pair from the invite section -- two independent forms sharing one
  // status line would let one's "Working…" clobber the other's result.
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editStatus, setEditStatus] = useState("");
  const [editIsError, setEditIsError] = useState(false);
  const editNameId = useId();
  const editDescriptionId = useId();

  const orgsRes = useAsyncResource<MyOrg[]>(
    (signal) => fetchMyOrgs(token, signal).then((r) => r.organizations),
    { deps: [sessionKey], enabled: isAuthenticated },
  );

  const orgs = orgsRes.data ?? [];
  const active = pickActiveOrg(orgs, activeTenantId);

  // Pending/spent org invites — owner/admin only (same gate as the endpoint).
  const invitesRes = useAsyncResource<OrgInvite[]>(
    (signal) =>
      active
        ? fetchOrgInvites(active.id, token, signal).then((r) => r.invites)
        : Promise.resolve([]),
    { deps: [sessionKey, active?.id], enabled: isAuthenticated && canManage && !!active },
  );

  function report(msg: string, err = false) {
    setStatus(msg);
    setIsError(err);
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

  // Sync the edit form's fields whenever the active org changes (initial load,
  // org switch, or a reload after a successful save) -- but only from the
  // server's own values, never overwriting mid-edit input the user is
  // actively typing into a DIFFERENT org's form (keyed on active?.id so a
  // reload of the SAME org after save re-syncs to the just-saved values).
  useEffect(() => {
    setEditName(active?.name ?? "");
    setEditDescription(active?.description ?? "");
  }, [active?.id, active?.name, active?.description]);

  async function handleUpdateOrg(e: React.FormEvent) {
    e.preventDefault();
    if (!active || !editName.trim()) return;
    setEditBusy(true);
    setEditStatus("Saving…");
    setEditIsError(false);
    try {
      await updateOrganization(
        active.id,
        { name: editName.trim(), description: editDescription.trim() },
        token,
      );
      await orgsRes.reload();
      setEditStatus("Organization updated.");
    } catch (err) {
      setEditStatus(friendlyErrorMessage(err));
      setEditIsError(true);
    } finally {
      setEditBusy(false);
    }
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

          {/* #1503: edit the active org's own name/description. Owner/admin
            only -- same `canManage` gate as the member-management section
            below (mirrors the backend's `_require_org_manage` authority). */}
          {canManage && (
            <section className={`mb-4 ${cardClass}`}>
              <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
                <Icon name="edit" size={17} className="text-indigo-500 dark:text-indigo-400" />
                Organization details
              </h2>
              <form onSubmit={handleUpdateOrg} className="flex flex-col gap-3">
                <div>
                  <label htmlFor={editNameId} className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                    Name
                  </label>
                  <input
                    id={editNameId}
                    type="text"
                    className={inputClass}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    disabled={editBusy}
                    maxLength={200}
                    required
                  />
                </div>
                <div>
                  <label htmlFor={editDescriptionId} className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                    Description
                  </label>
                  <textarea
                    id={editDescriptionId}
                    className={`${inputClass} min-h-20`}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    disabled={editBusy}
                    placeholder="What this organization is for…"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={editBusy || !editName.trim()}
                    className={primaryButtonClass}
                  >
                    Save
                  </button>
                  <StatusLine isError={editIsError}>{editStatus}</StatusLine>
                </div>
              </form>
            </section>
          )}

          {/* Members live on their own org-scoped Users page, with actions
            shown per the caller's permissions in this org. */}
          <section className={cardClass}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
                <Icon name="users" size={17} className="text-indigo-500 dark:text-indigo-400" />
                Members
              </h2>
              <div className="flex items-center gap-4">
                <Link
                  to={ORG_USERS_PATH}
                  className="flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  {canManage ? "Manage users" : "View users"}
                  <Icon name="arrow" size={14} />
                </Link>
                <Link
                  to="/platform/teams"
                  className="flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  Manage teams
                  <Icon name="arrow" size={14} />
                </Link>
              </div>
            </div>
            <p className={`mt-2 ${mutedTextClass}`}>
              Who belongs to {active.name}, their roles, and their access are
              on the Users page. Day-to-day sharing is done through Teams.
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
              <StatusLine isError={isError} className="mb-0 mt-2">
                {status}
              </StatusLine>

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
