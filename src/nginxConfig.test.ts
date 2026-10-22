// Checks nginx.conf (the config the Docker image serves the client with).
// Every response carries the security headers docker/security-headers.sh
// writes (and index.html has no inline script their CSP would block). The
// password reset page reads a one-time token from its URL fragment, and the
// invite page carries its token in the path and hosts a password form, so
// every URL React Router renders either for must get
// `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.
import { describe, expect, it } from "vitest";
import securityHeadersSh from "../docker/security-headers.sh?raw";
import indexHtml from "../index.html?raw";
import nginxConf from "../nginx.conf?raw";

interface Location {
  modifier: string;
  pattern: string;
  body: string;
}

/** The `location` blocks of the config, comments removed. Location bodies
 * here don't nest braces, which this parser relies on. */
function locations(conf: string): Location[] {
  const text = conf.replace(/#.*$/gm, "");
  return [...text.matchAll(/location\s+(=|~\*?|\^~)?\s*(\S+)\s*\{([^{}]*)\}/g)].map((m) => ({
    modifier: m[1] ?? "",
    pattern: m[2],
    body: m[3],
  }));
}

/** The location nginx picks for `path`: an exact match, then the longest
 * prefix if it's `^~`, then the first matching regex, then the longest
 * prefix. */
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

/** Arguments of every `name` directive in a block, quotes removed. */
function directives(body: string, name: string): string[] {
  return [...body.matchAll(new RegExp(`(?:^|;|\\s)${name}\\s+([^;]+);`, "g"))].map((m) =>
    m[1].replace(/"/g, "").trim().replace(/\s+/g, " "),
  );
}

const all = locations(nginxConf);

/** The no-referrer / no-store checks for every path that renders a page
 * whose URL carries a secret. */
function expectProtected(paths: string[]) {
  for (const path of paths) {
    describe(path, () => {
      const loc = locationFor(all, path);

      it("is served by a dedicated location, not the SPA fallback", () => {
        expect(loc).toBeDefined();
        expect(loc!.pattern).not.toBe("/");
      });

      it("sends Referrer-Policy: no-referrer and Cache-Control: no-store", () => {
        const headers = directives(loc!.body, "add_header");
        expect(headers).toContain("Referrer-Policy no-referrer always");
        expect(headers).toContain("Cache-Control no-store always");
      });

      it("serves index.html in place, so the headers aren't dropped", () => {
        // A final try_files URI is an internal redirect into `location /`,
        // which loses this block's add_header lines; `=404` keeps it here.
        expect(directives(loc!.body, "try_files")).toEqual(["/index.html =404"]);
      });
    });
  }
}

describe("nginx.conf reset-password route", () => {
  it("parses the config's location blocks", () => {
    expect(all.map((l) => l.pattern)).toEqual(expect.arrayContaining(["/", "/health"]));
  });

  // React Router matches routes case-insensitively and ignores a trailing
  // slash, so all of these render ResetPasswordPage.
  expectProtected(["/reset-password", "/reset-password/", "/RESET-PASSWORD", "/Reset-Password/"]);

  it("leaves other routes on the SPA fallback without these headers", () => {
    const login = locationFor(all, "/login");
    expect(login?.pattern).toBe("/");
    expect(directives(login!.body, "add_header")).toEqual([]);
    expect(locationFor(all, "/reset-password-extra")?.pattern).toBe("/");
    expect(locationFor(all, "/Reset-Password/extra")?.pattern).toBe("/");
  });
});

describe("nginx.conf verify-email route", () => {
  expectProtected(["/verify-email", "/verify-email/", "/VERIFY-EMAIL", "/Verify-Email/"]);

  it("leaves look-alike routes on the SPA fallback", () => {
    expect(locationFor(all, "/verify-email-extra")?.pattern).toBe("/");
    expect(locationFor(all, "/verify-email/extra")?.pattern).toBe("/");
  });
});

describe("nginx.conf invite route", () => {
  // Every URL React Router renders InviteRedeemPage (/invite/:token) for, as
  // nginx sees it: decoded, so a token with an encoded slash (/invite/a%2Fb)
  // is matched as /invite/a/b.
  expectProtected(["/invite/tok123", "/invite/tok123/", "/INVITE/Tok-123_x", "/Invite/a/b"]);

  it("leaves other paths on the SPA fallback", () => {
    expect(locationFor(all, "/invite")?.pattern).toBe("/");
    expect(locationFor(all, "/invite/")?.pattern).toBe("/");
    expect(locationFor(all, "/invites/tok")?.pattern).toBe("/");
  });
});

describe("nginx.conf security headers", () => {
  const HEADERS = "/etc/nginx/minder/security-headers.conf";
  const REFERRER = "/etc/nginx/minder/referrer-policy.conf";
  const server = nginxConf.replace(/#.*$/gm, "").replace(/location[^{]*\{[^{}]*\}/g, "");

  it("includes both snippets at server level, for the SPA fallback", () => {
    expect(directives(server, "include")).toEqual([HEADERS, REFERRER]);
    expect(directives(locationFor(all, "/")!.body, "add_header")).toEqual([]);
  });

  // nginx drops inherited add_header lines in a location that has its own.
  it("re-includes the headers in every location with its own add_header", () => {
    for (const loc of all.filter((l) => directives(l.body, "add_header").length > 0)) {
      const includes = directives(loc.body, "include");
      expect(includes, loc.pattern).toContain(HEADERS);
      const ownReferrer = directives(loc.body, "add_header").some((h) =>
        h.startsWith("Referrer-Policy"),
      );
      // Exactly one Referrer-Policy: the location's own, or the snippet's.
      expect(includes.includes(REFERRER), loc.pattern).toBe(!ownReferrer);
    }
  });

  it("sends HSTS only for a request forwarded over HTTPS", () => {
    const map = nginxConf.match(/map \$http_x_forwarded_proto \$minder_hsts \{([^}]*)\}/);
    expect(map).not.toBeNull();
    expect(map![1]).toMatch(/default\s+"";/);
    expect(map![1]).toMatch(/https\s+"max-age=\d+";/);
  });
});

describe("docker/security-headers.sh", () => {
  const csp = securityHeadersSh.match(/default_csp="([^"]*)"/)![1].replace(/\\\n/g, "");
  const directive = (name: string) =>
    csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith(`${name} `));

  it("defaults to a CSP that allows no inline or third-party script and no framing", () => {
    expect(directive("script-src")).toBe("script-src 'self'");
    expect(directive("style-src")).toBe("style-src 'self'");
    expect(directive("object-src")).toBe("object-src 'none'");
    expect(directive("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive("connect-src")).toBe("connect-src 'self'${api_origin:+ $api_origin}");
    expect(csp).not.toContain("unsafe-");
  });

  it("writes the basic headers next to the CSP", () => {
    for (const header of [
      'add_header Content-Security-Policy "$csp" always;',
      "add_header X-Content-Type-Options nosniff always;",
      "add_header X-Frame-Options DENY always;",
      "add_header Strict-Transport-Security \\$minder_hsts always;",
      "add_header Referrer-Policy no-referrer always;",
    ]) {
      expect(securityHeadersSh).toContain(header);
    }
  });

  it("can be turned off", () => {
    expect(securityHeadersSh).toMatch(/\[Oo\]\[Ff\]\[Ff\][^)]*\)\s*:\s*>"\$headers"/);
  });
});

describe("index.html", () => {
  // script-src 'self' blocks inline scripts: every <script> must load a file.
  it("has no inline script", () => {
    const scripts = [...indexHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, attrs, body] of scripts) {
      expect(attrs).toMatch(/\ssrc=/i);
      expect(body.trim()).toBe("");
    }
  });
});
