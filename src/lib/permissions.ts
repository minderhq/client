/**
 * What the caller may do: the permission model behind `useCan` (#131).
 *
 * Every gate in the shell (sidebar, in-page tabs, command palette, route
 * guards) goes through one place instead of reading role fields:
 *
 *  - `can(key, scope)` for an org or team permission, keyed by the server's
 *    permission catalogue (`org.members.manage`, `team.members.manage`, …);
 *  - `isPlatformAdmin` for the installation operator's screens. The Platform
 *    Admin is deliberately outside the org permission engine, so those
 *    screens check the flag, never a key;
 *  - `isMember` for the product itself (any signed-in caller).
 *
 * All three are answered from an {@link EffectivePermissions} value, shaped
 * like the server's "my effective permissions" response. Today that value is
 * built from the session's role claims ({@link effectivePermissionsFromRoles},
 * one table: {@link ORG_ROLE_PERMISSIONS}); later `usePermissions` (useCan.ts)
 * fetches it from the API instead. Nothing else changes: not the keys, not
 * {@link accessFrom}, not any caller.
 */

/** Org-level permission keys, as the server's catalogue names them. The last
 * two are product permissions the catalogue does not have yet, named the
 * same way so adopting them is a lookup, not a rename. */
export const ORG_PERMISSION_KEYS = [
  "org.members.view",
  "org.members.invite",
  "org.members.manage",
  "org.members.suspend",
  "org.roles.manage",
  "org.teams.manage",
  "org.settings.manage",
  "org.billing.view",
  "org.billing.manage",
  "org.audit.view",
  "org.suborgs.create",
  "org.suborgs.manage",
  /** Configure AI providers and default models (product permission). */
  "org.ai.manage",
  /** Manage public (website) chatbots and their conversations (product permission). */
  "org.chatbots.manage",
] as const;

/** Team-level permission keys, as the server's catalogue names them. */
export const TEAM_PERMISSION_KEYS = [
  "team.members.view",
  "team.members.manage",
  "team.members.suspend",
  "team.settings.manage",
  "team.sharing.manage",
  "team.subteams.manage",
] as const;

export type OrgPermissionKey = (typeof ORG_PERMISSION_KEYS)[number];
export type TeamPermissionKey = (typeof TEAM_PERMISSION_KEYS)[number];
export type PermissionKey = OrgPermissionKey | TeamPermissionKey;

export const PERMISSION_KEYS: readonly PermissionKey[] = [
  ...ORG_PERMISSION_KEYS,
  ...TEAM_PERMISSION_KEYS,
];

/** Where a permission is asked about. Omitted: the active org (and, for a
 * team key, any of the caller's teams). */
export interface PermissionScope {
  orgId?: string;
  teamId?: string;
}

/** Why the caller holds a key: the role or group it came from (the server
 * names it; today it is the role name, or "billing" for the billing probe). */
export interface PermissionGrant {
  key: PermissionKey;
  source: string;
}

/** The caller's effective permissions, in the shape of the server's
 * "my permissions" response. Null (not this) while signed out. */
export interface EffectivePermissions {
  is_platform_admin: boolean;
  active_org: {
    id: string;
    org_role: string;
    permissions: PermissionGrant[];
  } | null;
  teams: { id: string; team_role: string; permissions: PermissionGrant[] }[];
  /** Bumped by the server whenever the caller's access changes. */
  permission_version: number;
}

/** The answers every gate reads. */
export interface Access {
  /** Signed in: may use the product (chat, knowledge, marketplace, account). */
  isMember: boolean;
  /** The installation operator: every org, backups, plugin review, sources. */
  isPlatformAdmin: boolean;
  /** May the caller do `key` in `scope`? */
  can: (key: PermissionKey, scope?: PermissionScope) => boolean;
}

/** What a nav entry or route needs: a permission key, or one of the two
 * gates that are not keys. */
export const MEMBER = "member";
export const PLATFORM_ADMIN = "platform-admin";
export type Requirement = PermissionKey | typeof MEMBER | typeof PLATFORM_ADMIN;

/** Does `access` satisfy `requirement` (in the active org)? */
export function allows(access: Access, requirement: Requirement): boolean {
  if (requirement === MEMBER) return access.isMember;
  if (requirement === PLATFORM_ADMIN) return access.isPlatformAdmin;
  return access.can(requirement);
}

/** The gates, answered from effective permissions (null: signed out). The
 * Platform Admin holds every key installation-wide; an org grant holds only
 * in the org it was granted in; a team grant only in its team. */
export function accessFrom(effective: EffectivePermissions | null): Access {
  if (!effective) {
    return { isMember: false, isPlatformAdmin: false, can: () => false };
  }
  const orgKeys = new Set(effective.active_org?.permissions.map((p) => p.key));
  return {
    isMember: true,
    isPlatformAdmin: effective.is_platform_admin,
    can: (key, scope) => {
      if (effective.is_platform_admin) return true;
      const org = effective.active_org;
      if (!org || (scope?.orgId !== undefined && scope.orgId !== org.id)) return false;
      if (orgKeys.has(key)) return true;
      if (!key.startsWith("team.")) return false;
      return effective.teams.some(
        (team) =>
          (scope?.teamId === undefined || scope.teamId === team.id) &&
          team.permissions.some((p) => p.key === key),
      );
    },
  };
}

// --- Today: effective permissions derived from the role claims -------------

/** The keys each org role holds today: the permission each page and API
 * actually checks, written once. Billing view is not here: the server
 * decides it (custom roles included), so it comes from the billing probe.
 * `org.audit.view` is absent too: the audit log is an operator screen today. */
export const ORG_ROLE_PERMISSIONS: Record<string, readonly OrgPermissionKey[]> = {
  owner: [
    "org.members.view",
    "org.members.invite",
    "org.members.manage",
    "org.members.suspend",
    "org.roles.manage",
    "org.teams.manage",
    "org.settings.manage",
    "org.billing.manage",
    "org.ai.manage",
    "org.chatbots.manage",
  ],
  admin: [
    "org.members.view",
    "org.members.invite",
    "org.members.manage",
    "org.members.suspend",
    "org.roles.manage",
    "org.teams.manage",
    "org.settings.manage",
    "org.ai.manage",
    "org.chatbots.manage",
  ],
  member: ["org.members.view"],
};

/** The keys each team role holds. The token carries no team roles, so the
 * role-backed value lists no teams yet; the table is here for the API's. */
export const TEAM_ROLE_PERMISSIONS: Record<string, readonly TeamPermissionKey[]> = {
  team_admin: [
    "team.members.view",
    "team.members.manage",
    "team.members.suspend",
    "team.settings.manage",
    "team.sharing.manage",
    "team.subteams.manage",
  ],
  member: ["team.members.view"],
};

/** The facts today's role checks read. */
export interface RoleFacts {
  authenticated: boolean;
  /** Installation-level role: "admin" | "user". */
  role: string;
  /** Role in the active org: "owner" | "admin" | "member". */
  orgRole: string;
  /** The `is_platform_admin` claim. */
  isPlatformAdmin: boolean;
  /** The active org id ("" for a token without one). */
  activeOrgId: string;
  /** Whether GET /v1/billing/subscription let the caller in. */
  billingVisible: boolean;
}

/** Effective permissions as today's role checks see them. Only the
 * `is_platform_admin` claim makes a Platform Admin: the operator APIs refuse
 * the instance role "admin" without it (an org owner or an SSO admin). */
export function effectivePermissionsFromRoles(facts: RoleFacts): EffectivePermissions | null {
  if (!facts.authenticated) return null;
  const orgRole = facts.orgRole || "member";
  const permissions: PermissionGrant[] = (ORG_ROLE_PERMISSIONS[orgRole] ?? []).map((key) => ({
    key,
    source: orgRole,
  }));
  if (facts.billingVisible) permissions.push({ key: "org.billing.view", source: "billing" });
  return {
    is_platform_admin: facts.isPlatformAdmin,
    active_org: { id: facts.activeOrgId, org_role: orgRole, permissions },
    teams: [],
    permission_version: 0,
  };
}
