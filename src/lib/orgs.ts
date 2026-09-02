import { apiFetch } from "./api";

/** An organization the current user belongs to (GET /v1/organizations/mine). */
export interface MyOrg {
  id: number;
  name: string;
  slug: string;
  /** The caller's role WITHIN this org: owner / admin / member. */
  org_role: string;
  /** Their primary (home) org — the tenant their data is created under by default. */
  is_home: boolean;
}

export interface MyOrgsResponse {
  organizations: MyOrg[];
  active_organization_id: number | null;
}

/** A member of an organization (GET /v1/organizations/{id}/members). */
export interface OrgMember {
  user_id: number;
  username: string;
  email: string;
  org_role: string;
  is_home: boolean;
}

export interface OrgMembersResponse {
  members: OrgMember[];
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

/** A directory user (GET /v1/auth/users, admin) — for the add-member picker. */
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
