// The Installed view's model (#2193): what plugin-registry actually runs on this
// installation (`GET /v1/plugins`) merged with the caller's own marketplace
// installation records (`/v1/marketplace/installations/me`). Those are two
// independent planes today -- first-party plugins run with no per-user
// install row at all -- until decision (B) on #2091 unifies them.
//
// Since #2223 both payloads carry what the merge needs (#2219): a running
// plugin's `install_source` and `marketplace_plugin_id`, and an installation's
// `origin`. The whole catalog is only fetched, and the name join and URL
// heuristic only used, against an older backend that lacks those fields.

import { type CatalogPlugin, hasBackendField, type RuntimePlugin } from "./marketplace";
import { type SourceKind, sourceFromInstallSource, sourceFromOrigin } from "./pluginSource";
import { legacyCatalogRowSource } from "./pluginSourceLegacy";
import { normalizeVersion } from "./pluginVersion";
import type { Installation } from "./types";

export interface InstalledEntry {
  /** Unique and stable across reloads: the runtime name for a running plugin,
   * the catalog id for an installation-only one. Two entries may share a
   * `name` (a git install named like someone else's submission), never a
   * `key`. */
  key: string;
  /** The plugin's name: plugin-registry's for a running plugin (what its
   * per-plugin endpoints take), else the installation's. */
  name: string;
  displayName: string;
  /** The caller's marketplace installation record, if they have one. */
  installation: Installation | null;
  /** plugin-registry's runtime entry, if it has this plugin loaded. */
  runtime: RuntimePlugin | null;
  /** The matching catalog row -- only looked up against an older backend
   * (see {@link needsCatalogFallback}); null otherwise. */
  catalog: CatalogPlugin | null;
  source: SourceKind | null;
  /** The version that's running (plugin-registry), else the one the
   * installation record holds; null when neither knows. */
  installedVersion: string | null;
  /** The version the catalog lists (the installation record's copy of it, or
   * the catalog row on the legacy path); null when unknown. */
  listedVersion: string | null;
  requiresServices: string[];
}

/** Whether the card should offer Configure, from what the backend already
 * told us: `true`/`false` from the running plugin's `configurable` (#2219,
 * the same predicate `GET /v1/plugins/{name}/config` uses); `false` when the
 * complete runtime list doesn't include the plugin (nothing is running to
 * ask -- the config endpoint would 404 "not running"); `undefined` when
 * unknown (a registry older than #2219, or the runtime list didn't load), in
 * which case the panel asks lazily as before. */
export function configurableOf(
  runtime: RuntimePlugin | null,
  runtimeKnown: boolean,
): boolean | undefined {
  if (runtime) return typeof runtime.configurable === "boolean" ? runtime.configurable : undefined;
  return runtimeKnown ? false : undefined;
}

/** Whether the Installed view must fall back to fetching the whole catalog:
 * true only when a payload comes from a backend older than #2219 -- a runtime
 * entry without `install_source`/`marketplace_plugin_id`, or an installation
 * without `origin`. The two services deploy independently, so each payload is
 * checked on its own. Nothing loaded means nothing to classify. */
export function needsCatalogFallback(
  installations: readonly Installation[] | null,
  runtime: readonly RuntimePlugin[] | null,
): boolean {
  return (
    (runtime ?? []).some(
      (rt) =>
        !hasBackendField(rt, "install_source") || !hasBackendField(rt, "marketplace_plugin_id"),
    ) || (installations ?? []).some((inst) => !hasBackendField(inst, "origin"))
  );
}

/** The badge for one entry, from backend fields first:
 *
 *  1. a running plugin's `install_source` -- how it got onto this
 *     installation (vendored → First-party, git → Private git, manifest →
 *     Manifest upload);
 *  2. else the installation record's catalog `origin` (first_party →
 *     First-party, submitted → Submitted on this instance);
 *  3. else nothing: a null or unknown value gets no badge, never a guess.
 *
 * Only a payload from an older backend falls back to the legacy URL heuristic
 * on its catalog row, which is exactly what it showed before #2223. */
function entrySource(
  rt: RuntimePlugin | null,
  inst: Installation | null,
  row: CatalogPlugin | null,
): SourceKind | null {
  if (rt) {
    const source = hasBackendField(rt, "install_source")
      ? sourceFromInstallSource(rt.install_source)
      : legacyCatalogRowSource(row);
    if (source) return source;
  }
  if (inst) {
    return hasBackendField(inst, "origin")
      ? sourceFromOrigin(inst.origin)
      : legacyCatalogRowSource(row);
  }
  return null;
}

/** Runtime ∪ installations, sorted by display name. Any of the inputs may be
 * null (not loaded / failed); the merge then works with what it has.
 *
 * A running plugin is joined to the caller's installation record (and, on
 * the legacy path, to its catalog row) by `marketplace_plugin_id`, never by
 * name, so a same-named row that isn't its own can't take over its badge,
 * version or card. The name is used only:
 *  - when the registry predates the field (key absent): the pre-#2223 join;
 *  - when the id is null for a vendored plugin and the same-named record is
 *    a first-party listing: plugin-registry creates that listing by name for
 *    the code plugins it ships, so it is this plugin's own row whose id the
 *    registry hasn't resolved yet. A submission or another install can't
 *    match this, so it can't reintroduce the collision. */
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

  /** An installation's catalog origin: its own `origin`, or -- from a
   * marketplace older than #2219, which doesn't send it -- its catalog row's
   * (the fallback fetches the catalog exactly in that case). */
  function originOf(inst: Installation): string | null | undefined {
    return hasBackendField(inst, "origin")
      ? inst.origin
      : catalogById.get(inst.plugin_id)?.origin;
  }

  // One record per catalog id (the first wins). By name, a first-party record
  // wins over any other of the same name: it's the only one a running
  // vendored plugin can be (see installationFor).
  const instById = new Map<string, Installation>();
  const instByName = new Map<string, Installation>();
  for (const inst of installations ?? []) {
    if (instById.has(inst.plugin_id)) continue;
    instById.set(inst.plugin_id, inst);
    const held = instByName.get(inst.name);
    if (!held || (originOf(held) !== "first_party" && originOf(inst) === "first_party")) {
      instByName.set(inst.name, inst);
    }
  }

  function installationFor(rt: RuntimePlugin): Installation | null {
    if (!hasBackendField(rt, "marketplace_plugin_id")) return instByName.get(rt.name) ?? null;
    if (rt.marketplace_plugin_id) return instById.get(rt.marketplace_plugin_id) ?? null;
    const sameName = instByName.get(rt.name);
    return sameName && rt.install_source === "vendored" && originOf(sameName) === "first_party"
      ? sameName
      : null;
  }

  function catalogRowFor(
    rt: RuntimePlugin | null,
    inst: Installation | null,
  ): CatalogPlugin | null {
    if (inst) {
      const row = catalogById.get(inst.plugin_id);
      if (row) return row;
    }
    if (!rt) return null;
    if (!hasBackendField(rt, "marketplace_plugin_id")) return catalogByName.get(rt.name) ?? null;
    return rt.marketplace_plugin_id ? (catalogById.get(rt.marketplace_plugin_id) ?? null) : null;
  }

  function entry(
    key: string,
    name: string,
    rt: RuntimePlugin | null,
    inst: Installation | null,
  ): InstalledEntry {
    const row = catalogRowFor(rt, inst);
    return {
      key,
      name,
      displayName: inst?.display_name || row?.display_name || name,
      installation: inst,
      runtime: rt,
      catalog: row,
      source: entrySource(rt, inst, row),
      installedVersion: normalizeVersion(rt?.version) ?? normalizeVersion(inst?.version),
      listedVersion:
        normalizeVersion(row?.current_version) ?? normalizeVersion(inst?.current_version),
      requiresServices: inst?.requires_services ?? row?.requires_services ?? [],
    };
  }

  const entries: InstalledEntry[] = [];
  const claimed = new Set<Installation>();
  const seenRuntime = new Set<string>();
  for (const rt of runtime ?? []) {
    if (seenRuntime.has(rt.name)) continue; // registry names are unique; first wins
    seenRuntime.add(rt.name);
    let inst = installationFor(rt);
    if (inst && claimed.has(inst)) inst = null;
    if (inst) claimed.add(inst);
    entries.push(entry(`runtime:${rt.name}`, rt.name, rt, inst));
  }
  for (const inst of instById.values()) {
    if (claimed.has(inst)) continue;
    entries.push(entry(`installation:${inst.plugin_id}`, inst.name, null, inst));
  }

  return entries.sort(
    (a, b) =>
      a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }) ||
      a.name.localeCompare(b.name) ||
      a.key.localeCompare(b.key),
  );
}
