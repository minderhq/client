// Installed-vs-listed version comparison for plugin cards (#2193). Display
// only: the update action itself is #2199 / #2202.

/** Trimmed version string, or null when absent/blank. */
export function normalizeVersion(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

interface ParsedVersion {
  core: number[];
  pre: string | null;
}

function parseVersion(v: string): ParsedVersion | null {
  const m = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v);
  if (!m) return null;
  return { core: m[1].split(".").map(Number), pre: m[2] ?? null };
}

/** Semver-style ordering of two version strings: negative when `a < b`,
 * positive when `a > b`, 0 when equal, and null when they can't be ordered
 * (not dotted-numeric, or two different pre-releases of the same core). Build
 * metadata (`+...`) is ignored, as in semver; missing trailing parts count as
 * zero (`1.2` == `1.2.0`). */
export function compareVersions(a: string, b: string): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  const len = Math.max(pa.core.length, pb.core.length);
  for (let i = 0; i < len; i++) {
    const d = (pa.core[i] ?? 0) - (pb.core[i] ?? 0);
    if (d !== 0) return d;
  }
  if (pa.pre === pb.pre) return 0;
  // A release outranks its own pre-releases (1.0.0 > 1.0.0-rc.1).
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  return null;
}

export type VersionHint =
  /** The catalog lists a strictly newer version than the one installed. */
  | { kind: "newer"; listed: string }
  /** The two differ but can't be ordered (non-semver strings). */
  | { kind: "different"; listed: string };

/** What, if anything, to say about the listed version next to the installed
 * one. Nothing when either is unknown, when they're equal, or when the
 * installed one is the newer of the two (that's not an update). */
export function versionHint(
  installed: string | null | undefined,
  listed: string | null | undefined,
): VersionHint | null {
  const i = normalizeVersion(installed);
  const l = normalizeVersion(listed);
  if (!i || !l || i === l) return null;
  const cmp = compareVersions(l, i);
  if (cmp === null) return { kind: "different", listed: l };
  return cmp > 0 ? { kind: "newer", listed: l } : null;
}

/** "1.2.0" → "v1.2.0"; anything not starting with a digit ("v1.2", "latest")
 * is shown as-is. */
export function formatVersion(v: string): string {
  return /^\d/.test(v) ? `v${v}` : v;
}
