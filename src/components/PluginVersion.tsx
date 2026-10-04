import { formatVersion, normalizeVersion, type VersionHint, versionHint } from "../lib/pluginVersion";
import { Icon } from "./Icon";

/** The quiet installed-vs-listed note shared by both version displays. */
function VersionHintNote({ hint, installed }: { hint: VersionHint; installed: string }) {
  const listed = formatVersion(hint.listed);
  const mine = formatVersion(installed);
  return (
    <span
      className="inline-flex items-center gap-1 text-gray-500 dark:text-gray-400"
      title={
        hint.kind === "newer"
          ? `The catalog lists ${listed}; this installation has ${mine}.`
          : `The catalog lists ${listed}, which differs from the installed ${mine}.`
      }
    >
      <Icon name={hint.kind === "newer" ? "version-up" : "info"} size={12} className="shrink-0" />
      {hint.kind === "newer" ? `Newer version listed: ${listed}` : `Listed version: ${listed}`}
    </span>
  );
}

/** Installed-card version (#2193): the installed/running version plus, when the
 * catalog lists a newer (or an unorderable, different) one, a quiet hint.
 * Display only -- updating is #2199 / #2202. Renders nothing when no installed
 * version is known: a blank is more honest than a made-up "unknown". */
export function PluginVersion({
  installed,
  listed,
}: {
  installed: string | null | undefined;
  listed: string | null | undefined;
}) {
  const version = normalizeVersion(installed);
  if (!version) return null;
  const hint = versionHint(version, listed);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2">
      <span>
        <span className="sr-only">Installed version </span>
        {formatVersion(version)}
      </span>
      {hint && <VersionHintNote hint={hint} installed={version} />}
    </span>
  );
}

/** Browse-card version (#2193): the version the catalog lists and, when the
 * caller has an older one installed, the same quiet hint. Renders nothing when
 * the catalog lists no version. */
export function ListedVersion({
  listed,
  installed,
}: {
  listed: string | null | undefined;
  installed: string | null | undefined;
}) {
  const version = normalizeVersion(listed);
  if (!version) return null;
  const mine = normalizeVersion(installed);
  const hint = mine ? versionHint(mine, version) : null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2">
      <span>
        <span className="sr-only">Listed version </span>
        {formatVersion(version)}
      </span>
      {hint && mine && (
        <span
          className="inline-flex items-center gap-1"
          title={`You have ${formatVersion(mine)} installed; the catalog lists ${formatVersion(version)}.`}
        >
          <Icon name={hint.kind === "newer" ? "version-up" : "info"} size={12} className="shrink-0" />
          {hint.kind === "newer"
            ? `You have ${formatVersion(mine)} · newer version listed`
            : `You have ${formatVersion(mine)}`}
        </span>
      )}
    </span>
  );
}
