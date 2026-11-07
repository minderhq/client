/** Parse a backend timestamp. Several services store naive UTC `TIMESTAMP`
 * columns, so the API can return ISO strings without an offset; `new Date()`
 * would read those as local time (#148). Treat an offset-less value as UTC. */
export function parseServerTimestamp(value: string | null | undefined): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const v = value.trim();
  // A date-only string is already UTC in JS; only a bare date-time needs the Z.
  const naive = /T\d{2}:\d{2}/.test(v) && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(v);
  const date = new Date(naive ? `${v}Z` : v);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A server timestamp in the browser's local date and time, or `fallback`
 * when it is missing or unparseable. */
export function formatServerTime(value: string | null | undefined, fallback = "—"): string {
  return parseServerTimestamp(value)?.toLocaleString() ?? fallback;
}
