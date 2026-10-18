import type { Locale } from "../i18n";
import { apiFetch } from "./api";
import type { Theme } from "./theme";

/** The caller's own Minder-specific profile (GET /v1/profile/me).
 *
 * This is Minder's OWN per-user state, deliberately NOT the Authelia-owned
 * identity fields (username / email / password / group-role) — those live in
 * the Authelia portal and are synced into Minder on SSO login, never edited
 * here. `display_name` is an optional Minder-side display name (it never
 * overrides Authelia's username); `preferences` is a small free-form blob of
 * app preferences (e.g. theme) persisted server-side so a user's choices follow
 * their account across devices. */
export interface UserProfile {
  user_id: number;
  display_name: string | null;
  preferences: ProfilePreferences;
  created_at?: string | null;
  updated_at?: string | null;
  /** `ready` | `none` | `pending_request` (a plain string: read it through
   * `normalizeWorkspaceState`). Null when the API couldn't determine it;
   * absent from a gateway that predates #2234. */
  workspace_state?: string | null;
  /** Whether `POST /v1/organizations/personal` would be accepted. */
  can_create_workspace?: boolean | null;
  /** Whether the account has confirmed its email address (#2447). Null when
   * the API couldn't determine it; absent from an older gateway. */
  email_verified?: boolean | null;
  /** True while the account must confirm its email address before it can be
   * used: every request outside the verification allowlist answers `403
   * email_verification_required`. Null/absent: unknown. */
  email_verification_required?: boolean | null;
  /** The account's chosen UI language (#133); null when it hasn't picked one.
   * Absent from an older gateway. The published OpenAPI snapshot doesn't
   * describe these three fields yet, so they are declared here. */
  locale?: Locale | null;
  /** The active organization's default language; null when it has none. */
  organization_default_locale?: Locale | null;
  /** The server's resolution: `locale`, else the org default, else its own
   * default. The client adds the browser's languages before that last step
   * (i18n/locale.ts, profileLocale). */
  effective_locale?: Locale | null;
}

export type WorkspaceState = "ready" | "none" | "pending_request";

/** The profile's `workspace_state` as a known value. An unknown string reads
 * as `none` (the safe, most restrictive reading); null/absent -- the API
 * could not say, or predates the field -- reads as `null`, i.e. no gating. */
export function normalizeWorkspaceState(
  raw: string | null | undefined,
): WorkspaceState | null {
  if (raw === null || raw === undefined) return null;
  return raw === "ready" || raw === "pending_request" ? raw : "none";
}

/** The response of `POST /v1/organizations/personal` (#2234): the new
 * workspace plus a fresh token that carries it as the caller's tenant. */
export interface PersonalOrgResponse {
  id: string;
  name: string;
  slug: string;
  access_token: string;
  expires_in: number;
  token_type?: string;
}

/** Create the caller's own personal workspace ("Create my workspace"). */
export function createPersonalWorkspace(token: string) {
  return apiFetch<PersonalOrgResponse>("/v1/organizations/personal", {
    method: "POST",
    token,
  });
}

/** The known keys inside the otherwise free-form preferences blob. Kept as a
 * loose index type so a new preference can be added without a schema change on
 * either side — only the keys the UI actually renders need to be declared. */
export interface ProfilePreferences {
  /** Persisted UI theme, mirroring lib/theme.ts's Theme so a user's choice
   * follows their account instead of living only in one browser's localStorage. */
  theme?: Theme;
  [key: string]: unknown;
}

/** PATCH body for updateMyProfile — every field optional, only what's supplied
 * is changed; `preferences`, when supplied, REPLACES the stored blob. The
 * backend rejects an entirely-empty body. */
export interface UpdateProfileBody {
  display_name?: string | null;
  preferences?: ProfilePreferences;
  /** The account's UI language; null clears it (then the org default
   * applies). Any other value is rejected with a 422. */
  locale?: Locale | null;
}

/** Fetch the authenticated caller's own Minder profile/preferences. */
export function fetchMyProfile(token: string, signal?: AbortSignal) {
  return apiFetch<UserProfile>("/v1/profile/me", { token, signal });
}

/** Save the caller's UI language to their account (#133). */
export function saveMyLocale(locale: Locale | null, token: string) {
  return updateMyProfile({ locale }, token);
}

/** Edit the authenticated caller's own Minder profile/preferences. */
export function updateMyProfile(body: UpdateProfileBody, token: string) {
  return apiFetch<UserProfile>("/v1/profile/me", {
    method: "PATCH",
    body,
    token,
  });
}
