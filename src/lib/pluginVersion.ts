// Installed-vs-listed version comparison for plugin cards (#2193). Display
// only: the update action itself is #2199 / #2202.

/** Trimmed version string, or null when absent/blank. */
export function normalizeVersion(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

interface ParsedVersion {
  core: number[];
  /** Pre-release identifiers ("rc.1" → ["rc", "1"]), empty for a release. */
  pre: string[];
}

function parseVersion(v: string): ParsedVersion | null {
  const m = /^[vV]?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v);
  if (!m) return null;
  return { core: m[1].split(".").map(Number), pre: m[2] ? m[2].split(".") : [] };
}

/** Whether `v` parses as a version carrying a pre-release tag (`1.1.0-beta`). */
export function isPrerelease(v: string): boolean {
  return (parseVersion(v.trim())?.pre.length ?? 0) > 0;
}

const NUMERIC_ID = /^\d+$/;

/** semver §11.4: compare pre-release identifier lists field by field. Numeric
 * identifiers compare numerically and rank below alphanumeric ones;
 * alphanumeric ones compare in ASCII order; a shorter list that is a prefix of
 * the longer one ranks lower (`alpha` < `alpha.1`). */
function comparePrerelease(a: string[], b: string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    const xn = NUMERIC_ID.test(x);
    const yn = NUMERIC_ID.test(y);
    if (xn && yn) return Number(x) - Number(y);
    if (xn) return -1;
    if (yn) return 1;
    return x < y ? -1 : 1;
  }
  return a.length - b.length;
}

/** Semver ordering of two version strings: negative when `a < b`, positive when
 * `a > b`, 0 when equal, and null when either isn't a version (`latest`,
 * `nightly`). A leading `v`/`V` and build metadata (`+...`) are ignored, as in
 * semver; missing trailing core parts count as zero (`1.2` == `1.2.0`); a
 * pre-release ranks below its release (`1.0.0-rc.1` < `1.0.0`), and
 * pre-releases of the same core follow semver precedence (`alpha` < `beta`,
 * `rc.1` < `rc.2` < `rc.10`). */
export function compareVersions(a: string, b: string): number | null {
  const pa = parseVersion(a.trim());
  const pb = parseVersion(b.trim());
  if (!pa || !pb) return null;
  const len = Math.max(pa.core.length, pb.core.length);
  for (let i = 0; i < len; i++) {
    const d = (pa.core[i] ?? 0) - (pb.core[i] ?? 0);
    if (d !== 0) return d;
  }
  if (pa.pre.length === 0 || pb.pre.length === 0) {
    // A release outranks any pre-release of the same core.
    return pb.pre.length - pa.pre.length;
  }
  return comparePrerelease(pa.pre, pb.pre);
}

export type VersionHint =
  /** The catalog lists a strictly newer version than the one installed. */
  | { kind: "newer"; listed: string }
  /** The two differ but can't be ordered (not version strings). */
  | { kind: "different"; listed: string };

/** What, if anything, to say about the listed version next to the installed
 * one. Nothing when either is unknown, when they're equal, when the installed
 * one is the newer of the two (that's not an update), or when the only newer
 * listing is a pre-release while a stable release is installed (a beta isn't
 * an update to offer someone on a release). */
export function versionHint(
  installed: string | null | undefined,
  listed: string | null | undefined,
): VersionHint | null {
  const i = normalizeVersion(installed);
  const l = normalizeVersion(listed);
  if (!i || !l || i === l) return null;
  const cmp = compareVersions(l, i);
  if (cmp === null) return { kind: "different", listed: l };
  if (cmp <= 0) return null;
  if (isPrerelease(l) && !isPrerelease(i)) return null;
  return { kind: "newer", listed: l };
}

/** "1.2.0" → "v1.2.0"; anything not starting with a digit ("v1.2", "latest")
 * is shown as-is. */
export function formatVersion(v: string): string {
  return /^\d/.test(v) ? `v${v}` : v;
}
