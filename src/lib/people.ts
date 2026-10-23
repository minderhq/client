/**
 * Organization › People (client#126, UX step 7): the calls the People area
 * makes beyond lib/orgs.ts (members, single invites), and the small pure
 * helpers its pages share. Every route here is the api-gateway's own; the
 * server re-checks every permission, so these only decide what to show.
 */
import { apiFetch } from "./api";
import type { components } from "./api-types.gen";
import type { OrgInvite } from "./orgs";

/** One address's outcome; a created row's `invite` carries `email_delivery`. */
export type BulkInviteResult = Omit<components["schemas"]["BulkOrgInviteResultItem"], "invite"> & {
  invite?: OrgInvite | null;
};
export type OrgRole = components["schemas"]["RoleOut"];
export type RoleAssignment = components["schemas"]["MemberRoleAssignmentOut"];
export type PermissionEntry = components["schemas"]["EffectivePermissionEntry"];
export type OrgPolicy = components["schemas"]["OrgPolicyOut"];
export type PolicyKnob = components["schemas"]["OrgPolicyKnobOut"];

/** The most addresses `POST /invites/bulk` takes in one request. */
export const BULK_INVITE_MAX = 100;

/** Invite many addresses at one role. The gateway answers 207 with one
 * outcome per address; a longer list is sent in chunks of
 * {@link BULK_INVITE_MAX}, and the outcomes are joined in order. */
export async function bulkInvite(
  orgId: number,
  emails: string[],
  orgRole: string,
  token: string,
): Promise<BulkInviteResult[]> {
  const results: BulkInviteResult[] = [];
  for (let i = 0; i < emails.length; i += BULK_INVITE_MAX) {
    const res = await apiFetch<{ results: BulkInviteResult[] }>(
      `/v1/organizations/${orgId}/invites/bulk`,
      { method: "POST", body: { emails: emails.slice(i, i + BULK_INVITE_MAX), org_role: orgRole }, token },
    );
    results.push(...res.results);
  }
  return results;
}

/** A pasted or uploaded list of addresses: split on commas, semicolons and
 * whitespace (so a one-column CSV or an Outlook "a; b" line both work),
 * lower-cased and de-duplicated in order. `invalid` keeps what doesn't look
 * like an address so the admin sees it instead of losing it silently; the
 * gateway still validates every one it gets. */
export function parseEmailList(text: string): { emails: string[]; invalid: string[] } {
  const emails: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[\s,;]+/)) {
    const token = raw.trim().replace(/^["'<]+|["'>]+$/g, "");
    if (!token) continue;
    const email = token.toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) emails.push(email);
    else invalid.push(token);
  }
  return { emails, invalid };
}

/** Every role usable in the org: the system roles (owner, admin, member; set
 * through the membership) and the org's custom roles (granted on their own),
 * each with its flattened permission keys. */
export function fetchOrgRoles(orgId: number, token: string, signal?: AbortSignal) {
  return apiFetch<components["schemas"]["RolesResponse"]>(`/v1/organizations/${orgId}/roles`, {
    token,
    signal,
  });
}

/** A member's role grants (system and custom), with their expiry. */
export function fetchMemberRoles(orgId: number, userId: number, token: string, signal?: AbortSignal) {
  return apiFetch<components["schemas"]["MemberRoleAssignmentsResponse"]>(
    `/v1/organizations/${orgId}/members/${userId}/roles`,
    { token, signal },
  );
}

/** Grant a custom role, optionally until `expiresAt` (ISO). */
export function grantMemberRole(
  orgId: number,
  userId: number,
  roleId: number,
  expiresAt: string | null,
  token: string,
) {
  return apiFetch(`/v1/organizations/${orgId}/members/${userId}/roles`, {
    method: "POST",
    body: { role_id: roleId, expires_at: expiresAt },
    token,
  });
}

export function revokeMemberRole(orgId: number, userId: number, roleId: number, token: string) {
  return apiFetch(`/v1/organizations/${orgId}/members/${userId}/roles/${roleId}`, {
    method: "DELETE",
    token,
  });
}

/** What a member may do, each permission with the role (and permission
 * group, or parent organization) it comes from. */
export function fetchMemberPermissions(orgId: number, userId: number, token: string, signal?: AbortSignal) {
  return apiFetch<components["schemas"]["EffectivePermissionsResponse"]>(
    `/v1/organizations/${orgId}/members/${userId}/effective-permissions`,
    { token, signal },
  );
}

export function fetchOrgPolicy(orgId: number, token: string, signal?: AbortSignal) {
  return apiFetch<OrgPolicy>(`/v1/organizations/${orgId}/policy`, { token, signal });
}

/** Set the allowed email domains; null (or an empty list) resets them. */
export function updateAllowedDomains(orgId: number, domains: string[] | null, token: string) {
  return apiFetch<OrgPolicy>(`/v1/organizations/${orgId}/policy`, {
    method: "PATCH",
    body: { allowed_email_domains: domains },
    token,
  });
}

/** What changing from one role to another adds and takes away, by
 * permission key (the impact preview before a role change). */
export function roleImpact(
  roles: readonly OrgRole[],
  from: string,
  to: string,
): { gains: string[]; loses: string[] } | null {
  const before = roles.find((r) => r.is_system && r.name === from);
  const after = roles.find((r) => r.is_system && r.name === to);
  if (!before || !after) return null;
  const had = new Set(before.permissions);
  const will = new Set(after.permissions);
  return {
    gains: [...will].filter((k) => !had.has(k)).sort(),
    loses: [...had].filter((k) => !will.has(k)).sort(),
  };
}
