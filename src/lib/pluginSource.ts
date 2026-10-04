// Where a plugin came from (#2193): one classification shared by the source
// badge (Discover + Installed cards) and Discover's source filter. Source is a
// filter and a badge on ONE catalog, never a separate store (epic #2192).
//
// Since #2223 every badge comes from a field the backend returns (#2219) --
// nothing is inferred from URLs or names here:
//  - a running plugin's `install_source` (`GET /v1/plugins`) says how it got
//    onto this installation;
//  - a catalog row's (or installation record's) `origin` says who listed it.
// An older backend that lacks those fields is handled, in isolation, by
// `pluginSourceLegacy.ts`.

import type { IconName } from "../components/Icon";

/** Every source a plugin can have. `mindhub` is reserved for Phase 2 (#2202):
 * nothing resolves to it yet (the backend reserves the value but doesn't emit
 * it), but the badge and filter already know how to render it so adding it
 * later is a data change, not a UI redesign. */
export type SourceKind = "first_party" | "private_git" | "manifest" | "submitted" | "mindhub";

export interface SourceMeta {
  /** Badge text. */
  label: string;
  /** Option text in Discover's source filter. */
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
    description: "Installed on this installation from a git repository.",
    param: "private",
    icon: "source-git",
    toneClass: "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  },
  manifest: {
    label: "Manifest upload",
    filterLabel: "Manifest upload",
    description: "Installed on this installation by uploading its plugin manifest.",
    param: "manifest",
    icon: "source-manifest",
    toneClass: "bg-violet-50 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
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

/** Own-key lookup, so a value such as `"constructor"` or `"__proto__"` can't
 * resolve through the prototype chain. */
function lookup(map: Readonly<Record<string, SourceKind>>, value: unknown): SourceKind | null {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(map, value)
    ? map[value]
    : null;
}

/** plugin-registry's `InstallSource` (#2219) → badge. */
const INSTALL_SOURCE_KIND: Readonly<Record<string, SourceKind>> = {
  vendored: "first_party",
  git: "private_git",
  manifest: "manifest",
};

/** The marketplace's `PluginOrigin` (#2219) → badge. */
const ORIGIN_KIND: Readonly<Record<string, SourceKind>> = {
  first_party: "first_party",
  submitted: "submitted",
};

/** The badge for a running plugin's `install_source` (`vendored` → First-party,
 * `git` → Private git, `manifest` → Manifest upload). Null -- no badge -- for
 * null, absent or any value this client doesn't know (including the reserved
 * `mindhub`, until Phase 2 defines what it means for an install). */
export function sourceFromInstallSource(installSource: unknown): SourceKind | null {
  return lookup(INSTALL_SOURCE_KIND, installSource);
}

/** The badge for a catalog `origin` (`first_party` → First-party, `submitted`
 * → Submitted on this instance). Null for anything else. */
export function sourceFromOrigin(origin: unknown): SourceKind | null {
  return lookup(ORIGIN_KIND, origin);
}

/** The badge for a marketplace catalog row (Discover): its `origin`. A catalog
 * row is never a git or manifest install -- those are registered by
 * plugin-registry without a catalog listing -- so Private git and Manifest
 * upload only appear on Installed, where `install_source` says so. */
export function resolveCatalogSource(
  row: { origin?: string | null } | null | undefined,
): SourceKind | null {
  return sourceFromOrigin(row?.origin);
}

/** Sources a catalog row can resolve to: what Discover's legend explains. */
export const CATALOG_SOURCE_KINDS: readonly SourceKind[] = ["first_party", "submitted"];

/** Sources an installed plugin can resolve to: what Installed's legend
 * explains. */
export const INSTALLED_SOURCE_KINDS: readonly SourceKind[] = [
  "first_party",
  "private_git",
  "manifest",
  "submitted",
];

/** The sources Discover's filter offers, in display order -- the ones a catalog
 * row can have. Phase 2 adds `"mindhub"` here once MindHub items can appear in
 * the catalog. */
export const SOURCE_FILTER_KINDS: readonly SourceKind[] = CATALOG_SOURCE_KINDS;

/** The catalog list/search `origin` query value that filters a source
 * server-side, across every page (#2219). A source without one can only be
 * filtered client-side, over the pages already loaded. */
const SERVER_ORIGIN_FILTER: Partial<Record<SourceKind, string>> = {
  first_party: "first_party",
  submitted: "submitted",
};

/** The `origin` param for `filter`, or null when the server can't filter it
 * (or no filter is selected). */
export function serverOriginFilter(filter: SourceKind | null): string | null {
  return (filter && SERVER_ORIGIN_FILTER[filter]) ?? null;
}

/** Name of the Discover query param carrying the source filter. */
export const SOURCE_PARAM = "source";

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
