/**
 * Persona fixtures for role/route matrix tests (client#126).
 *
 * Each persona is the auth state the app actually reads: the JWT claims that
 * `decodeJwtClaims` (lib/jwt.ts) turns into `useAuth()`, plus the few facts the
 * client learns from the API rather than the token:
 *
 *  - billing visibility (`useBillingAccess` probes GET /v1/billing/subscription
 *    and hides Billing only on a 403; the server decides it from the
 *    `org.billing.view` permission, so the fixture states it explicitly);
 *  - team membership and `team_role` (never in the token: TeamsPage reads it
 *    from GET /v1/teams/{id});
 *  - the plan tier (only in the subscription response).
 *
 * Instance role vs org role: `role` is the installation-level role
 * ("admin" | "user") and `org_role` the role inside the active org
 * ("owner" | "admin" | "member"). The shell's gates (useCan, lib/permissions.ts)
 * read `role`, `org_role` and `is_platform_admin` -- see navigation.matrix.test.tsx.
 *
 * Fixtures only build state; renderApp.tsx turns one into a rendered app.
 */
import { DEFAULT_SUBMISSION_TIER, UPGRADE_TIERS } from "../lib/billing";
import { accessFrom, effectivePermissionsFromRoles, type Access } from "../lib/permissions";

export type PersonaId =
  | "platformAdmin"
  | "orgOwner"
  | "orgAdmin"
  | "teamAdmin"
  | "teamMember"
  | "teamlessMember"
  | "loggedOut";

/** The plan tiers the client can see in a subscription response. The free
 * baseline is "community" (`Subscription.baseline`); there is no separate
 * "free" tier in the client's vocabulary. Names come from lib/billing.ts, the
 * one module allowed to spell them. */
export const PLAN_TIERS = [DEFAULT_SUBMISSION_TIER, ...UPGRADE_TIERS] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];
export const BASELINE_TIER: PlanTier = DEFAULT_SUBMISSION_TIER;

export type TeamRole = "member" | "team_admin";

export interface PersonaTeam {
  id: number;
  name: string;
  team_role: TeamRole;
}

/** The JWT payload fields the client decodes (lib/jwt.ts). */
export interface PersonaClaims {
  sub: string;
  username: string;
  email: string;
  /** Installation-level role: "admin" | "user". */
  role: string;
  tenant_id?: string;
  active_tenant_id?: string;
  /** Role within the active org: "owner" | "admin" | "member". */
  org_role?: string;
  is_platform_admin?: boolean;
}

export interface Persona {
  id: PersonaId;
  /** Human label, used in test names. */
  label: string;
  /** Null for the logged-out visitor (no token stored). */
  claims: PersonaClaims | null;
  /** What GET /v1/billing/subscription answers this caller: `view: false`
   * is a 403 (Billing hidden); `canManage` is the response's `can_manage`. */
  billing: { view: boolean; canManage: boolean };
  /** The active org's plan. */
  tier: PlanTier;
  /** Teams the caller belongs to, with their team role. */
  teams: PersonaTeam[];
  /** A custom org role's keys, as GET /v1/me/permissions answers them
   * (default: the org role's keys from the role table). */
  orgKeys?: string[];
  /** Requests waiting for the caller's decision (the inbox's `total`). */
  pendingRequests?: number;
}

const ORG_ID = "1";

function orgClaims(
  sub: string,
  username: string,
  orgRole: string,
  extra: Partial<PersonaClaims> = {},
): PersonaClaims {
  return {
    sub,
    username,
    email: `${username}@example.test`,
    role: "user",
    tenant_id: ORG_ID,
    active_tenant_id: ORG_ID,
    org_role: orgRole,
    ...extra,
  };
}

const ENGINEERING = { id: 10, name: "Engineering" };

export const PERSONAS: Record<PersonaId, Persona> = {
  // The installation operator. The token carries the legacy instance role
  // "admin" as well as `is_platform_admin`, as the gateway mints it.
  platformAdmin: {
    id: "platformAdmin",
    label: "platform admin",
    claims: orgClaims("1", "platform-admin", "owner", { role: "admin", is_platform_admin: true }),
    billing: { view: true, canManage: true },
    tier: BASELINE_TIER,
    teams: [],
  },
  orgOwner: {
    id: "orgOwner",
    label: "org owner",
    claims: orgClaims("2", "org-owner", "owner"),
    billing: { view: true, canManage: true },
    tier: BASELINE_TIER,
    teams: [],
  },
  // An org admin may view billing but not change the plan (only owners and
  // billing managers can).
  orgAdmin: {
    id: "orgAdmin",
    label: "org admin",
    claims: orgClaims("3", "org-admin", "admin"),
    billing: { view: true, canManage: false },
    tier: BASELINE_TIER,
    teams: [],
  },
  teamAdmin: {
    id: "teamAdmin",
    label: "team admin",
    claims: orgClaims("4", "team-admin", "member"),
    billing: { view: false, canManage: false },
    tier: BASELINE_TIER,
    teams: [{ ...ENGINEERING, team_role: "team_admin" }],
  },
  teamMember: {
    id: "teamMember",
    label: "team member",
    claims: orgClaims("5", "team-member", "member"),
    billing: { view: false, canManage: false },
    tier: BASELINE_TIER,
    teams: [{ ...ENGINEERING, team_role: "member" }],
  },
  teamlessMember: {
    id: "teamlessMember",
    label: "team-less member",
    claims: orgClaims("6", "teamless-member", "member"),
    billing: { view: false, canManage: false },
    tier: BASELINE_TIER,
    teams: [],
  },
  loggedOut: {
    id: "loggedOut",
    label: "logged-out visitor",
    claims: null,
    billing: { view: false, canManage: false },
    tier: BASELINE_TIER,
    teams: [],
  },
};

export const PERSONA_IDS = Object.keys(PERSONAS) as PersonaId[];

/** A persona with some fields replaced, e.g. a plan variant
 * (`withPersona("orgOwner", { tier: "pro" })`) or an unusual token
 * (`withPersona("orgOwner", { claims: { is_platform_admin: true } })`).
 * Claim overrides need a signed-in persona: passing them for `loggedOut`
 * (which has no token) throws instead of being silently dropped. */
export function withPersona(
  id: PersonaId,
  overrides: Partial<Omit<Persona, "claims">> & { claims?: Partial<PersonaClaims> } = {},
): Persona {
  const base = PERSONAS[id];
  const { claims, ...rest } = overrides;
  if (claims && !base.claims) {
    throw new Error(`withPersona: "${id}" has no token, so claim overrides can't apply`);
  }
  return {
    ...base,
    ...rest,
    claims: base.claims && claims ? { ...base.claims, ...claims } : base.claims,
  };
}

/** The persona's plan tier variants (one per PLAN_TIERS entry). */
export function tierVariants(id: PersonaId): Persona[] {
  return PLAN_TIERS.map((tier) => withPersona(id, { tier, label: `${PERSONAS[id].label} (${tier})` }));
}

function b64url(o: object): string {
  return btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** An unsigned JWT carrying the persona's claims, valid for an hour (far
 * from the silent-refresh point, so no refresh fires during a test). */
export function personaToken(persona: Persona, now: number = Date.now()): string {
  if (!persona.claims) return "";
  const iat = Math.floor(now / 1000);
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({
    ...persona.claims,
    iat,
    exp: iat + 3600,
  })}.sig`;
}

/** The gates the shell derives for this persona: the same derivation useCan
 * runs (lib/permissions.ts), fed the persona's claims and billing verdict. A
 * logged-out visitor's billing probe never runs, so it reads as visible, but
 * a signed-out caller holds no permission anyway. The rendered-sidebar test in
 * navigation.matrix.test.tsx is the real check; this cross-checks the expected
 * tables against nav.ts. */
export function personaAccess(persona: Persona): Access {
  const claims = persona.claims;
  return accessFrom(effectivePermissionsFromRoles({
    authenticated: !!claims,
    role: claims?.role ?? "",
    orgRole: claims?.org_role ?? "",
    isPlatformAdmin: claims?.is_platform_admin === true,
    activeOrgId: claims?.active_tenant_id ?? claims?.tenant_id ?? "",
    billingVisible: claims ? persona.billing.view : true,
  }));
}
