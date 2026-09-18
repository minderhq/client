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
}

/** Fetch the authenticated caller's own Minder profile/preferences. */
export function fetchMyProfile(token: string, signal?: AbortSignal) {
  return apiFetch<UserProfile>("/v1/profile/me", { token, signal });
}

/** Edit the authenticated caller's own Minder profile/preferences. */
export function updateMyProfile(body: UpdateProfileBody, token: string) {
  return apiFetch<UserProfile>("/v1/profile/me", {
    method: "PATCH",
    body,
    token,
  });
}
