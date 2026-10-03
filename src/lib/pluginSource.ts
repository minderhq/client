// Where a plugin came from (#2193): one classification shared by the source
// badge (Browse + Installed cards) and Browse's source filter. Source is a
// filter and a badge on ONE catalog, never a separate store (epic #2192).

import type { IconName } from "../components/Icon";

/** Every source a catalog item can have. `mindhub` is reserved for Phase 2
 * (#2202): nothing resolves to it yet, but the badge and filter already know how
 * to render it so adding it later is a data change, not a UI redesign. */
export type SourceKind = "first_party" | "private_git" | "submitted" | "mindhub";

export interface SourceMeta {
  /** Badge text. */
  label: string;
  /** Option text in Browse's source filter. */
  filterLabel: string;
  /** Tooltip: what this source means, in one sentence. */
  description: string;
  /** Stable value used in the `?source=` query param (shareable URLs). */
  param: string;
  icon: IconName;
  /** Tint only -- the text + icon carry the meaning, never colour alone. */
  toneClass: string;
}

export const SOURCE_META: Record<SourceKind, SourceMeta> = {
  first_party: {
    label: "First-party",
    filterLabel: "First-party",
    description: "Maintained by the Minder project and shipped with this installation.",
    param: "first-party",
    icon: "source-first-party",
    toneClass: "bg-indigo-50 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200",
  },
  private_git: {
    label: "Private git",
    filterLabel: "Private git",
    description: "Added to this installation from a git repository outside the first-party catalog.",
    param: "private",
    icon: "source-git",
    toneClass: "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  },
  submitted: {
    label: "Submitted on this instance",
    filterLabel: "Submitted on this instance",
    description: "Submitted by a developer on this installation and approved through its review queue.",
    param: "submitted",
    icon: "submit",
    toneClass: "bg-sky-50 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  },
  mindhub: {
    label: "MindHub",
    filterLabel: "MindHub",
    description: "Listed on MindHub, the public Minder plugin hub.",
    param: "mindhub",
    icon: "globe",
    toneClass: "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  },
};

/** The sources Browse's filter offers, in display order. Phase 2 adds
 * `"mindhub"` here once MindHub items can appear in the catalog. */
export const SOURCE_FILTER_KINDS: readonly SourceKind[] = [
  "first_party",
  "private_git",
  "submitted",
];

/** Name of the Browse query param carrying the source filter. */
export const SOURCE_PARAM = "source";

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

/** Classifies a catalog row from the fields the backend actually returns:
 *
 *  - `origin: "submitted"` → Submitted on this instance (a reviewed developer
 *    submission, whatever repository it links to);
 *  - a `repository_url` outside the first-party catalog → Private git;
 *  - `origin: "first_party"` → First-party.
 *
 * Returns null -- the badge then renders nothing -- when there's no catalog
 * data to go on (an unknown/absent `origin` and no repository URL). Never
 * guesses: in particular a plugin plugin-registry runs with no catalog row at
 * all can't be classified, because `GET /v1/plugins` carries no source field. */
export function resolveSource(
  row: { origin?: string | null; repository_url?: string | null } | null | undefined,
): SourceKind | null {
  if (!row) return null;
  if (row.origin === "submitted") return "submitted";
  const repo = row.repository_url?.trim();
  if (repo && !isFirstPartyCatalogUrl(repo)) return "private_git";
  if (row.origin === "first_party") return "first_party";
  return null;
}

/** The filter selected by a `?source=` value, or null (= all sources) when it's
 * absent or not one of the offered filters. */
export function parseSourceFilter(param: string | null | undefined): SourceKind | null {
  if (!param) return null;
  return SOURCE_FILTER_KINDS.find((kind) => SOURCE_META[kind].param === param) ?? null;
}

/** Whether an item of `source` passes the `filter` (null = all sources). An
 * unclassified item only shows under "All sources". */
export function matchesSourceFilter(
  source: SourceKind | null,
  filter: SourceKind | null,
): boolean {
  return filter === null || source === filter;
}
