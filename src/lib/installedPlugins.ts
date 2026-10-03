// The Installed view's model (#2193): what plugin-registry actually runs on this
// installation (`GET /v1/plugins`) merged with the caller's own marketplace
// installation records (`/v1/marketplace/installations/me`). Those are two
// independent planes today -- first-party plugins run with no per-user
// install row at all -- until decision (B) on #2091 unifies them.

import type { CatalogPlugin, RuntimePlugin } from "./marketplace";
import { resolveSource, type SourceKind } from "./pluginSource";
import { normalizeVersion } from "./pluginVersion";
import type { Installation } from "./types";

export interface InstalledEntry {
  /** Plugin name -- the join key across all three payloads. */
  name: string;
  displayName: string;
  /** The caller's marketplace installation record, if they have one. */
  installation: Installation | null;
  /** plugin-registry's runtime entry, if it has this plugin loaded. */
  runtime: RuntimePlugin | null;
  /** The matching catalog row, if one is listed. */
  catalog: CatalogPlugin | null;
  source: SourceKind | null;
  /** The version that's running (plugin-registry), else the one the
   * installation record holds; null when neither knows. */
  installedVersion: string | null;
  /** The version the catalog lists, else the installation's copy of it. */
  listedVersion: string | null;
  requiresServices: string[];
}

function displayNameOf(
  installation: Installation | null,
  catalog: CatalogPlugin | null,
  name: string,
): string {
  return installation?.display_name || catalog?.display_name || name;
}

/** Runtime ∪ installations, de-duplicated by plugin name, each joined to its
 * catalog row (by marketplace id for installations, by name for runtime-only
 * plugins), sorted by display name. Any of the inputs may be null (not loaded /
 * failed); the merge then works with what it has.
 *
 * Known limitation -- name collisions: the name is the only key the runtime
 * list shares with the catalog. Catalog names are unique, but a runtime plugin
 * with no catalog row of its own can share a name with someone ELSE's row.
 * Examples: a git or manifest install named like a developer submission, or a
 * vendored plugin whose catalog sync was refused (409) because a submission
 * already took the name. That runtime plugin then shows the other row's
 * source badge and listed version, and an install record for that row merges
 * into its card. Pinned by tests; the fix is backend #2206 (source and
 * marketplace id on `GET /v1/plugins`, so the join stops being by name). */
export function mergeInstalledPlugins(
  installations: readonly Installation[] | null,
  runtime: readonly RuntimePlugin[] | null,
  catalog: readonly CatalogPlugin[] | null,
): InstalledEntry[] {
  const catalogById = new Map<string, CatalogPlugin>();
  const catalogByName = new Map<string, CatalogPlugin>();
  for (const row of catalog ?? []) {
    if (!catalogById.has(row.id)) catalogById.set(row.id, row);
    if (!catalogByName.has(row.name)) catalogByName.set(row.name, row);
  }

  const byName = new Map<
    string,
    { installation: Installation | null; runtime: RuntimePlugin | null }
  >();
  for (const inst of installations ?? []) {
    if (!byName.has(inst.name)) byName.set(inst.name, { installation: inst, runtime: null });
  }
  for (const rt of runtime ?? []) {
    const existing = byName.get(rt.name);
    if (!existing) byName.set(rt.name, { installation: null, runtime: rt });
    else if (!existing.runtime) existing.runtime = rt;
  }

  const entries: InstalledEntry[] = [];
  for (const [name, { installation, runtime: rt }] of byName) {
    const row =
      (installation && catalogById.get(installation.plugin_id)) ||
      catalogByName.get(name) ||
      null;
    entries.push({
      name,
      displayName: displayNameOf(installation, row, name),
      installation,
      runtime: rt,
      catalog: row,
      source: resolveSource(row),
      installedVersion:
        normalizeVersion(rt?.version) ?? normalizeVersion(installation?.version),
      listedVersion:
        normalizeVersion(row?.current_version) ??
        normalizeVersion(installation?.current_version),
      requiresServices: installation?.requires_services ?? row?.requires_services ?? [],
    });
  }

  return entries.sort(
    (a, b) =>
      a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }) ||
      a.name.localeCompare(b.name),
  );
}
