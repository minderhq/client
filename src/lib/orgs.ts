import { ApiError, apiFetch, friendlyErrorMessage } from "./api";
import type { components } from "./api-types.gen";

/** An organization the current user belongs to (GET /v1/organizations/mine). */
export interface MyOrg {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  /** The caller's role WITHIN this org: owner / admin / member. */
  org_role: string;
  /** Their primary (home) org — the tenant their data is created under by default. */
  is_home: boolean;
}

export interface MyOrgsResponse {
  organizations: MyOrg[];
  active_organization_id: number | null;
}

/** The active org's Users page (org-scoped member administration). The
 * installation-wide Platform Admin view stays at /platform/users. */
export const ORG_USERS_PATH = "/organization/users";

/** A member of an organization (GET /v1/organizations/{id}/members).
 *
 * Besides the org-visible state (`is_active`, `suspended_at`), each item says
 * what the CALLER may do to the account: `managed_by_caller` (account-level
 * deactivate/reactivate is allowed from this org) and `resettable_by_caller`
 * (the org-scoped password reset would be accepted). Both are hints for which
 * actions to offer; the action routes re-check everything. `is_oidc_linked`
 * and `must_change_password` are null unless the account is managed. */
export type OrgMember = components["schemas"]["OrgMemberListItem"];

export interface OrgMembersResponse {
  members: OrgMember[];
}

/** The org the caller is acting in: the token's active org, else their home
 * org, else the first one they belong to. */
export function pickActiveOrg(orgs: MyOrg[], activeTenantId: string): MyOrg | undefined {
  const activeId = activeTenantId ? Number(activeTenantId) : null;
  return orgs.find((o) => o.id === activeId) ?? orgs.find((o) => o.is_home) ?? orgs[0];
}

/** A member-administration error in words an admin can act on. A 403 never
 * logs anyone out: it is either a missing permission or the caller's own
 * pending forced password change. The API answers 404 alike for an unknown
 * user and one this org may not act on, so the message covers both. */
export function orgMemberErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403 && e.message.includes("password_change_required")) {
      return "Change your own password first: your account has a pending password change, so other actions are blocked until you do.";
    }
    if (e.status === 404) {
      return "That account isn't in this organization any more, or can't be managed from here. Refresh the list and try again.";
    }
  }
  return friendlyErrorMessage(e);
}

export function fetchMyOrgs(token: string, signal?: AbortSignal) {
  return apiFetch<MyOrgsResponse>("/v1/organizations/mine", { token, signal });
}

export function fetchOrgMembers(orgId: number, token: string, signal?: AbortSignal) {
  return apiFetch<OrgMembersResponse>(`/v1/organizations/${orgId}/members`, {
    token,
    signal,
  });
}

/** PATCH body for updateOrganization — every field optional, only what's
 * supplied is changed (the backend rejects an entirely-empty body). */
export interface UpdateOrgBody {
  name?: string;
  description?: string;
}

/** An updated org's own details (PATCH /v1/organizations/{id} response). */
export interface OrgDetail {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  created_at?: string | null;
}

/** Edit an org's own name/description. Owner/admin of the org (or an
 * instance/platform admin) only — same authority as managing its members. */
export function updateOrganization(
  orgId: number,
  body: UpdateOrgBody,
  token: string,
) {
  return apiFetch<OrgDetail>(`/v1/organizations/${orgId}`, {
    method: "PATCH",
    body,
    token,
  });
}

/** The org roles, strongest first — for role pickers. */
export const ORG_ROLES = ["owner", "admin", "member"] as const;

/** Add a member or change their role (the endpoint upserts on (org,user)). */
export function setOrgMember(
  orgId: number,
  userId: number,
  orgRole: string,
  token: string,
) {
  return apiFetch(`/v1/organizations/${orgId}/members`, {
    method: "POST",
    body: { user_id: userId, org_role: orgRole },
    token,
  });
}

export function removeOrgMember(orgId: number, userId: number, token: string) {
  return apiFetch(`/v1/organizations/${orgId}/members/${userId}`, {
    method: "DELETE",
    token,
  });
}

/** Suspend or restore a member's access to THIS org only. Their account and
 * other memberships are untouched (needs `org.members.suspend`). */
export function setOrgMemberSuspended(
  orgId: number,
  userId: number,
  suspended: boolean,
  token: string,
) {
  // Two literal paths (not a `${verb}` segment) so the API-contract test can
  // check each against the gateway spec.
  const path = suspended
    ? `/v1/organizations/${orgId}/members/${userId}/suspend`
    : `/v1/organizations/${orgId}/members/${userId}/unsuspend`;
  return apiFetch(path, { method: "POST", token });
}

/** Deactivate or reactivate a MANAGED member's whole account, from this org's
 * scope (only offered when the member list says `managed_by_caller`). */
export function setOrgMemberAccountActive(
  orgId: number,
  userId: number,
  isActive: boolean,
  token: string,
) {
  return apiFetch<components["schemas"]["OrgMemberAccountStatusOut"]>(
    `/v1/organizations/${orgId}/members/${userId}/account-status`,
    { method: "PATCH", body: { is_active: isActive }, token },
  );
}

/** The org-scoped reset-password route for one member — the endpoint the
 * shared reset control posts to from the org Users page. */
export function orgMemberResetPasswordPath(orgId: number, userId: number): string {
  return `/v1/organizations/${orgId}/members/${userId}/reset-password`;
}

/** Permission keys that gate the org Users page's actions. */
export const ORG_PERMISSIONS = {
  manage: "org.members.manage",
  suspend: "org.members.suspend",
} as const;

/** The caller's own resolved permission keys in `orgId` — direct grants plus
 * those delegated from an ancestor org. A member may always read their own. */
export async function fetchMyOrgPermissions(
  orgId: number,
  userId: string | number,
  token: string,
  signal?: AbortSignal,
): Promise<Set<string>> {
  const res = await apiFetch<components["schemas"]["EffectivePermissionsResponse"]>(
    `/v1/organizations/${orgId}/members/${userId}/effective-permissions`,
    { token, signal },
  );
  return new Set(res.permissions.map((p) => p.permission_key));
}

/** A directory user (GET /v1/auth/users, Platform Admin) — for the add-member picker. */
export interface DirectoryUser {
  id: number;
  username: string;
  email: string;
}

export function fetchAllUsers(token: string, signal?: AbortSignal) {
  return apiFetch<{ users: DirectoryUser[] }>("/v1/auth/users", { token, signal });
}

/** An organization in the platform-operator (admin) all-orgs view. */
export interface OrgListItem {
  id: number;
  name: string;
  slug: string;
  created_by: number | null;
  member_count: number;
  created_at: string | null;
}

export interface OrgListResponse {
  organizations: OrgListItem[];
  total: number;
  limit: number;
  offset: number;
}

export function fetchAllOrganizations(token: string, signal?: AbortSignal) {
  return apiFetch<OrgListResponse>("/v1/organizations?limit=200", { token, signal });
}

export interface CreateOrgBody {
  name: string;
  slug: string;
  /** Primary owner; the backend defaults to the creating admin when omitted. */
  owner_user_id?: number;
}

export function createOrganization(body: CreateOrgBody, token: string) {
  return apiFetch<{ id: string; name: string; slug: string }>("/v1/organizations", {
    method: "POST",
    body,
    token,
  });
}

/** An org-level invite (#1209). */
export interface OrgInvite {
  id: number;
  email: string;
  org_role: string | null;
  token: string;
  status: string;
  created_at: string | null;
  expires_at: string | null;
  max_uses: number;
  uses: number;
}

export function fetchOrgInvites(orgId: number, token: string, signal?: AbortSignal) {
  return apiFetch<{ invites: OrgInvite[]; total: number }>(
    `/v1/organizations/${orgId}/invites`,
    { token, signal },
  );
}

export function createOrgInvite(
  orgId: number,
  body: { email: string; org_role: string; max_uses?: number },
  token: string,
) {
  return apiFetch<OrgInvite>(`/v1/organizations/${orgId}/invites`, {
    method: "POST",
    body,
    token,
  });
}

export function revokeOrgInvite(orgId: number, inviteId: number, token: string) {
  return apiFetch<OrgInvite>(
    `/v1/organizations/${orgId}/invites/${inviteId}/revoke`,
    { method: "POST", token },
  );
}

/** Derive a url-safe slug suggestion from an org name (matches the backend's
 * ^[a-zA-Z0-9._-]+$ handle rule). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

/** Badge tone per org role — owner strongest, member neutral. Shared by the
 * switcher and the Organization page so the roles read consistently. */
export function orgRoleTone(role: string): string {
  if (role === "owner")
    return "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300";
  if (role === "admin")
    return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
  return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
}
