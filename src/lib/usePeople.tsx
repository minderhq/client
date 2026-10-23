import { useState } from "react";

import { useConfirm } from "../components/ConfirmDialog";
import { ImpactDetails } from "../components/PeopleCopy";
import { useI18n } from "../i18n";
import { ApiError } from "./api";
import { useAuth } from "./auth";
import {
  fetchMyOrgPermissions,
  fetchMyOrgs,
  fetchOrgMembers,
  type MyOrg,
  ORG_PERMISSIONS,
  type OrgMember,
  orgMemberErrorMessage,
  pickActiveOrg,
  removeOrgMember,
  setOrgMember,
  setOrgMemberAccountActive,
  setOrgMemberSuspended,
} from "./orgs";
import { fetchOrgRoles, type OrgRole, roleImpact, useTeamsByMember } from "./people";
import { useAsyncResource } from "./useAsyncResource";

/** A role's display name: the built-in ones translated, a custom role as
 * its admin named it. */
export function useRoleLabel(): (role: string) => string {
  const { t, messages } = useI18n();
  return (role) =>
    Object.hasOwn(messages.people.roles, role)
      ? t(`people.roles.${role as keyof typeof messages.people.roles}`)
      : role;
}

/** A permission key in words ("See members"), the key itself when the
 * catalog doesn't know it yet. */
export function usePermissionName(): (key: string) => string {
  const { messages } = useI18n();
  const names: Record<string, string> = messages.people.permissionNames;
  return (key) => (Object.hasOwn(names, key) ? names[key] : key);
}

/** The active org, its members, the caller's permissions there, the org's
 * roles and each member's teams: what the People pages read. */
export function usePeopleData() {
  const { isAuthenticated, token, sessionKey, userId, orgRole, activeTenantId, isPlatformAdmin } =
    useAuth();
  const { t } = useI18n();
  const orgsRes = useAsyncResource<MyOrg[]>(
    (signal) => fetchMyOrgs(token, signal).then((r) => r.organizations),
    { deps: [sessionKey], enabled: isAuthenticated },
  );
  const active = pickActiveOrg(orgsRes.data ?? [], activeTenantId);

  // What the caller may do here, from their resolved permissions in the
  // active org; if those can't be read, from the org role in the token
  // (owner/admin hold both by default). Only decides which controls to show.
  const permsRes = useAsyncResource<Set<string>>(
    (signal) => fetchMyOrgPermissions(active!.id, userId, token, signal),
    { deps: [sessionKey, active?.id, userId], enabled: isAuthenticated && !!active && !!userId },
  );
  const fallback = orgRole === "owner" || orgRole === "admin";
  const has = (key: string) =>
    !!isPlatformAdmin || (permsRes.data ? permsRes.data.has(key) : !!permsRes.error && fallback);

  const membersRes = useAsyncResource<OrgMember[]>(
    (signal) =>
      fetchOrgMembers(active!.id, token, signal).then(
        (r) => r.members,
        (e: unknown) => {
          // The list is gated on seeing members, so a plain 403 means exactly
          // that (never a logout); a pending password change has its own words.
          throw new Error(
            e instanceof ApiError && e.status === 403 && !e.message.includes("password_change_required")
              ? t("people.members.forbidden")
              : orgMemberErrorMessage(e),
          );
        },
      ),
    { deps: [sessionKey, active?.id], enabled: isAuthenticated && !!active },
  );
  const canManage = has(ORG_PERMISSIONS.manage);
  const rolesRes = useAsyncResource<OrgRole[]>(
    (signal) => fetchOrgRoles(active!.id, token, signal).then((r) => r.roles),
    { deps: [sessionKey, active?.id], enabled: isAuthenticated && !!active && canManage },
  );
  const teamsRes = useTeamsByMember(token, sessionKey, isAuthenticated && !!active && !isPlatformAdmin);
  return {
    orgsRes,
    active,
    membersRes,
    rolesRes,
    teamsRes,
    canManage,
    canSuspend: has(ORG_PERMISSIONS.suspend),
  };
}

/** Role change, suspend, remove and account (de)activation for one org's
 * members, each behind a confirmation that previews what the person gains
 * or loses. Shared by the members list and the person page. */
export function useMemberActions(
  org: MyOrg | undefined,
  roles: readonly OrgRole[],
  /** The member's roles and teams here, by name: what suspending or
   * removing them takes away. */
  holdingsOf: (m: OrgMember) => { roles: string[]; teams: string[] },
  onChanged: () => void,
) {
  const { token } = useAuth();
  const { t } = useI18n();
  const roleLabel = useRoleLabel();
  const permissionName = usePermissionName();
  const { confirm, dialog } = useConfirm();
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>, okMsg: string) {
    setBusy(true);
    setStatus(t("people.status.working"));
    setIsError(false);
    try {
      await fn();
      onChanged();
      setStatus(okMsg);
    } catch (e) {
      setStatus(orgMemberErrorMessage(e));
      setIsError(true);
    } finally {
      setBusy(false);
    }
  }

  /** What leaving (or being locked out of) the org takes away. */
  const losses = (m: OrgMember) => {
    const { roles: heldRoles, teams } = holdingsOf(m);
    return (
      <ImpactDetails
        groups={[
          { label: t("people.confirm.roles"), items: heldRoles },
          { label: t("people.confirm.teams"), items: teams },
        ]}
      />
    );
  };

  return {
    dialog,
    status,
    isError,
    busy,
    async changeRole(m: OrgMember, role: string) {
      if (!org) return;
      const impact = roleImpact(roles, m.org_role, role);
      const ok = await confirm({
        title: t("people.confirm.roleTitle", { name: m.username, role: roleLabel(role) }),
        message: t("people.confirm.roleMessage", {
          name: m.username,
          org: org.name,
          from: roleLabel(m.org_role),
          to: roleLabel(role),
        }),
        confirmLabel: t("people.confirm.roleConfirm"),
        details: impact && (
          <ImpactDetails
            groups={[
              { label: t("people.confirm.gains"), items: impact.gains.map(permissionName) },
              { label: t("people.confirm.loses"), items: impact.loses.map(permissionName) },
            ]}
          />
        ),
      });
      if (!ok) return;
      await run(() => setOrgMember(org.id, m.user_id, role, token), t("people.status.roleUpdated"));
    },
    async remove(m: OrgMember) {
      if (!org) return;
      const ok = await confirm({
        title: t("people.confirm.removeTitle", { name: m.username }),
        message: t("people.confirm.removeMessage", { name: m.username, org: org.name }),
        confirmLabel: t("people.actions.remove"),
        danger: true,
        details: losses(m),
      });
      if (!ok) return;
      await run(() => removeOrgMember(org.id, m.user_id, token), t("people.status.removed"));
    },
    async toggleSuspend(m: OrgMember) {
      if (!org) return;
      const suspend = !m.suspended_at;
      if (suspend) {
        const ok = await confirm({
          title: t("people.confirm.suspendTitle", { name: m.username }),
          message: t("people.confirm.suspendMessage", { name: m.username, org: org.name }),
          confirmLabel: t("people.actions.suspend"),
          danger: true,
          details: losses(m),
        });
        if (!ok) return;
      }
      await run(
        () => setOrgMemberSuspended(org.id, m.user_id, suspend, token),
        suspend ? t("people.status.suspended") : t("people.status.restored"),
      );
    },
    async toggleAccountActive(m: OrgMember) {
      if (!org) return;
      const activate = !m.is_active;
      if (!activate) {
        const ok = await confirm({
          title: t("people.confirm.deactivateTitle", { name: m.username }),
          message: t("people.confirm.deactivateMessage", { name: m.username }),
          confirmLabel: t("people.actions.deactivate"),
          danger: true,
        });
        if (!ok) return;
      }
      await run(
        () => setOrgMemberAccountActive(org.id, m.user_id, activate, token),
        activate ? t("people.status.reactivated") : t("people.status.deactivated"),
      );
    },
    async add(userId: number, role: string) {
      if (!org) return;
      await run(() => setOrgMember(org.id, userId, role, token), t("people.status.added"));
    },
  };
}

