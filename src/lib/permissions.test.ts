import { describe, expect, it } from "vitest";

import {
  accessFrom,
  allows,
  effectivePermissionsFromRoles,
  effectivePermissionsFromServer,
  MEMBER,
  PERMISSION_KEYS,
  PLATFORM_ADMIN,
  type EffectivePermissions,
  type PermissionKey,
  type RoleFacts,
} from "./permissions";

function facts(overrides: Partial<RoleFacts> = {}): RoleFacts {
  return {
    authenticated: true,
    role: "user",
    orgRole: "member",
    isPlatformAdmin: false,
    activeOrgId: "1",
    billingVisible: false,
    ...overrides,
  };
}

function accessFor(overrides: Partial<RoleFacts> = {}) {
  return accessFrom(effectivePermissionsFromRoles(facts(overrides)));
}

/** Every key the caller holds in the active org, in catalogue order. */
function granted(overrides: Partial<RoleFacts> = {}): PermissionKey[] {
  const { can } = accessFor(overrides);
  return PERMISSION_KEYS.filter((k) => can(k));
}

const ORG_ADMIN_KEYS: PermissionKey[] = [
  "org.members.view",
  "org.members.invite",
  "org.members.manage",
  "org.members.suspend",
  "org.roles.manage",
  "org.teams.manage",
  "org.settings.manage",
  "org.audit.view",
  "org.ai.manage",
  "org.chatbots.manage",
];

describe("effective permissions from today's role checks (#131)", () => {
  it("shapes them like the server's response, one grant per key with its source", () => {
    expect(effectivePermissionsFromRoles(facts({ orgRole: "member", billingVisible: true }))).toEqual({
      is_platform_admin: false,
      active_org: {
        id: "1",
        org_role: "member",
        permissions: [
          { key: "org.members.view", source: "member" },
          { key: "org.billing.view", source: "billing" },
        ],
      },
      teams: [],
      permission_version: 0,
    });
  });

  it("is null signed out", () => {
    expect(effectivePermissionsFromRoles(facts({ authenticated: false, role: "admin" }))).toBeNull();
  });

  it("gives a member the product and member visibility only", () => {
    expect(granted()).toEqual(["org.members.view"]);
    expect(accessFor().isMember).toBe(true);
    expect(accessFor().isPlatformAdmin).toBe(false);
  });

  it("gives an org admin the org administration keys, and an owner billing management too", () => {
    expect(granted({ orgRole: "admin" })).toEqual(ORG_ADMIN_KEYS);
    expect(granted({ orgRole: "owner" })).toEqual([...ORG_ADMIN_KEYS.slice(0, 7), "org.billing.manage", ...ORG_ADMIN_KEYS.slice(7)]);
  });

  it("takes billing view from the server's verdict, not the role", () => {
    expect(accessFor({ billingVisible: true }).can("org.billing.view")).toBe(true);
    expect(accessFor({ orgRole: "owner" }).can("org.billing.view")).toBe(false);
  });

  it("lets org owners/admins and the operator view the audit log, not plain members", () => {
    expect(accessFor({ orgRole: "owner" }).can("org.audit.view")).toBe(true);
    expect(accessFor({ orgRole: "admin" }).can("org.audit.view")).toBe(true);
    expect(accessFor({ orgRole: "member" }).can("org.audit.view")).toBe(false);
    expect(accessFor({ isPlatformAdmin: true }).can("org.audit.view")).toBe(true);
  });

  it("counts only the Platform Admin claim as the operator, not the instance admin role", () => {
    expect(accessFor({ isPlatformAdmin: true }).isPlatformAdmin).toBe(true);
    expect(accessFor({ role: "admin" }).isPlatformAdmin).toBe(false);
    expect(accessFor({ role: "admin" }).can("org.audit.view")).toBe(false);
    expect(accessFor({ orgRole: "owner" }).isPlatformAdmin).toBe(false);
  });
});

describe("accessFrom: the gates, from any effective permissions", () => {
  const response: EffectivePermissions = {
    is_platform_admin: false,
    active_org: {
      id: "1",
      org_role: "custom",
      permissions: [{ key: "org.billing.view", source: "Billing manager" }],
    },
    teams: [
      { id: "10", team_role: "team_admin", permissions: [{ key: "team.members.manage", source: "team_admin" }] },
      { id: "11", team_role: "member", permissions: [] },
    ],
    permission_version: 3,
  };
  const access = accessFrom(response);

  it("answers org keys from the active org's grants", () => {
    expect(access.can("org.billing.view")).toBe(true);
    expect(access.can("org.members.manage")).toBe(false);
  });

  it("scopes org keys to the active org", () => {
    expect(access.can("org.billing.view", { orgId: "1" })).toBe(true);
    expect(access.can("org.billing.view", { orgId: "2" })).toBe(false);
  });

  it("scopes team keys to the team that grants them", () => {
    expect(access.can("team.members.manage")).toBe(true);
    expect(access.can("team.members.manage", { teamId: "10" })).toBe(true);
    expect(access.can("team.members.manage", { teamId: "11" })).toBe(false);
  });

  it("lets the Platform Admin hold every key in every org, outside the engine", () => {
    const admin = accessFrom({ ...response, is_platform_admin: true });
    expect(admin.can("org.members.manage", { orgId: "2" })).toBe(true);
    expect(admin.can("team.members.manage", { teamId: "99" })).toBe(true);
  });

  it("allows nothing signed out", () => {
    const out = accessFrom(null);
    expect(out.isMember).toBe(false);
    expect(PERMISSION_KEYS.some((k) => out.can(k))).toBe(false);
  });

  it("checks requirements: a key, any member, or the Platform Admin", () => {
    expect(allows(access, MEMBER)).toBe(true);
    expect(allows(access, PLATFORM_ADMIN)).toBe(false);
    expect(allows(access, "org.billing.view")).toBe(true);
    expect(allows(accessFrom(null), MEMBER)).toBe(false);
  });
});

describe("effectivePermissionsFromServer", () => {
  const source = { kind: "role" as const, role_id: 7, role_name: "Knowledge manager" };
  it("maps the response to the client's shape", () => {
    const effective = effectivePermissionsFromServer({
      user_id: 1,
      is_platform_admin: false,
      active_org: {
        id: 3,
        org_role: "member",
        suspended: false,
        permissions: [{ key: "org.ai.manage", sources: [source] }],
        org_wide_team_permissions: [{ key: "team.members.view", sources: [{ kind: "role", role_id: 2 }] }],
      },
      teams: [{ id: 10, team_role: "member", permissions: [] }],
      permission_version: "1.4",
    });
    expect(effective).toEqual({
      is_platform_admin: false,
      active_org: {
        id: "3",
        org_role: "member",
        permissions: [{ key: "org.ai.manage", source: "Knowledge manager" }],
        org_wide_team_permissions: [{ key: "team.members.view", source: "role" }],
      },
      teams: [{ id: "10", team_role: "member", permissions: [] }],
      permission_version: "1.4",
    });
    const access = accessFrom(effective);
    expect(access.can("org.ai.manage", { orgId: "3" })).toBe(true);
    expect(access.can("team.members.view", { teamId: "42" })).toBe(true);
  });

  it("has no org without an active membership", () => {
    const effective = effectivePermissionsFromServer({
      user_id: 1,
      is_platform_admin: false,
      active_org: null,
      teams: [],
      permission_version: "1.1",
    });
    expect(accessFrom(effective).can("org.members.view")).toBe(false);
    expect(accessFrom(effective).isMember).toBe(true);
  });
});
