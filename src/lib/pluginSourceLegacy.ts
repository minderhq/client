// LEGACY FALLBACK -- older backends only. Delete once every deployment serves
// #2219's fields (`install_source` / `marketplace_plugin_id` on
// `GET /v1/plugins`, `origin` on `installations/me`).
//
// Before #2219 the backend didn't say how a plugin was installed, so #2193
// guessed it from the catalog row's `repository_url`. That guess is wrong in
// both directions (a vendored plugin whose manifest names its own repo showed
// as "Private git"; a git or manifest install with no catalog row showed no
// badge at all), so it is used ONLY when the backend can't answer: the
// Installed view calls it for an entry whose payloads lack those fields (see
// `installedPlugins.ts`). Nothing else may import this module.

import type { SourceKind } from "./pluginSource";

/** The repository the vendored first-party plugin catalog lives in. A catalog
 * row pointing here is first-party, not "private git". */
export const FIRST_PARTY_CATALOG_REPO = { host: "github.com", owner: "minderhq", repo: "plugins" };

/** Whether `url` points at the first-party plugin catalog repository (any
 * path inside it, with or without `.git`, `www.`, or a trailing slash). */
export function isFirstPartyCatalogUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== FIRST_PARTY_CATALOG_REPO.host) return false;
  const [owner = "", repo = ""] = parsed.pathname.split("/").filter(Boolean);
  return (
    owner.toLowerCase() === FIRST_PARTY_CATALOG_REPO.owner &&
    repo.toLowerCase().replace(/\.git$/, "") === FIRST_PARTY_CATALOG_REPO.repo
  );
}

/** The pre-#2219 classification of a catalog row, unchanged:
 *
 *  - `origin: "submitted"` → Submitted on this instance;
 *  - a `repository_url` outside the first-party catalog → Private git;
 *  - `origin: "first_party"` → First-party;
 *  - otherwise null (no badge). */
export function legacyCatalogRowSource(
  row: { origin?: string | null; repository_url?: string | null } | null | undefined,
): SourceKind | null {
  if (!row) return null;
  if (row.origin === "submitted") return "submitted";
  const repo = row.repository_url?.trim();
  if (repo && !isFirstPartyCatalogUrl(repo)) return "private_git";
  if (row.origin === "first_party") return "first_party";
  return null;
}
