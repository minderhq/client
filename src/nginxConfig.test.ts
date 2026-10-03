// Checks nginx.conf (the config the Docker image serves the client with) for
// the headers the token routes need (email ADR Decision 5, "Links"):
// `Referrer-Policy: no-referrer` and `Cache-Control: no-store` on every route
// that reads a one-time secret from its URL fragment.
import { describe, expect, it } from "vitest";
import nginxConf from "../nginx.conf?raw";

/** Client routes opened from an emailed link with `#token=…`. A new token
 * page (e.g. /verify-email in Phase 4) is added here and to nginx.conf. */
const TOKEN_ROUTES = ["/reset-password"];

interface Location {
  modifier: string;
  pattern: string;
  body: string;
}

/** The `location` blocks of the config, comments removed. Location bodies here
 * don't nest braces, which the test below relies on and checks. */
function locations(conf: string): Location[] {
  const text = conf.replace(/#.*$/gm, "");
  return [...text.matchAll(/location\s+(=|~\*?|\^~)?\s*(\S+)\s*\{([^{}]*)\}/g)].map(
    (m) => ({ modifier: m[1] ?? "", pattern: m[2], body: m[3] }),
  );
}

/** The location nginx picks for `path`, in nginx's order: an exact match,
 * then the longest prefix (unless it's `^~`), then the first matching regex,
 * then the longest prefix. */
function locationFor(all: Location[], path: string): Location | undefined {
  const exact = all.find((l) => l.modifier === "=" && l.pattern === path);
  if (exact) return exact;
  const prefixes = all
    .filter((l) => (l.modifier === "" || l.modifier === "^~") && path.startsWith(l.pattern))
    .sort((a, b) => b.pattern.length - a.pattern.length);
  if (prefixes[0]?.modifier === "^~") return prefixes[0];
  const regex = all.find(
    (l) =>
      l.modifier.startsWith("~") &&
      new RegExp(l.pattern, l.modifier === "~*" ? "i" : "").test(path),
  );
  return regex ?? prefixes[0];
}

function directives(body: string, name: string): string[] {
  return [...body.matchAll(new RegExp(`(?:^|;|\\s)${name}\\s+([^;]+);`, "g"))].map((m) =>
    m[1].trim().replace(/\s+/g, " "),
  );
}

describe("nginx.conf token routes", () => {
  const all = locations(nginxConf);

  it("parses the config's location blocks", () => {
    expect(all.map((l) => l.pattern)).toContain("/");
    expect(all.map((l) => l.pattern)).toContain("/health");
  });

  for (const route of TOKEN_ROUTES) {
    // React Router matches routes case-insensitively, so case variants render
    // the same page and must get the same headers.
    for (const path of [route, `${route}/`, route.toUpperCase(), "/Reset-Password/"]) {
      describe(path, () => {
        const loc = locationFor(all, path);

        it("is served by a dedicated location, not the SPA fallback", () => {
          expect(loc).toBeDefined();
          expect(loc!.pattern).not.toBe("/");
        });

        it("sends Referrer-Policy: no-referrer and Cache-Control: no-store", () => {
          const headers = directives(loc!.body, "add_header");
          expect(headers).toContain('Referrer-Policy "no-referrer" always');
          expect(headers).toContain('Cache-Control "no-store" always');
        });

        it("serves index.html in place, so the headers aren't dropped", () => {
          // A final try_files URI (`... /index.html`) is an internal redirect
          // into `location /`, which loses this block's add_header lines.
          // Only a final `=code` serves the file within this location.
          expect(directives(loc!.body, "try_files")).toEqual(["/index.html =404"]);
        });
      });
    }
  }

  it("leaves other routes on the SPA fallback without these headers", () => {
    const loc = locationFor(all, "/login");
    expect(loc?.pattern).toBe("/");
    expect(directives(loc!.body, "add_header")).toEqual([]);
    expect(locationFor(all, "/reset-password-extra")?.pattern).toBe("/");
    expect(locationFor(all, "/Reset-Password-Extra")?.pattern).toBe("/");
  });
});
