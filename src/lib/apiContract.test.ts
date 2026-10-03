// API contract check: every gateway path this client calls must exist in the
// published API Gateway OpenAPI spec (openapi/api-gateway.json, synced from
// the docs site -- see README "API contract"). A call to a route the gateway
// doesn't serve fails here instead of 404ing in production.
//
// Scans the TypeScript AST of every non-test source file for string/template
// literals that start with "/v1/" (wherever they appear: apiFetch/apiFetchBlob
// /fetch arguments or helper constants). When the literal is the first
// argument of apiFetch/apiFetchBlob/fetch, the HTTP method is checked as well
// (from an inline `{ method: "..." }`, default GET); otherwise only the path.
import ts from "typescript";
import { describe, expect, it } from "vitest";
import specText from "../../openapi/api-gateway.json?raw";

const PLACEHOLDER = "{}";
const FETCHERS = new Set(["apiFetch", "apiFetchBlob", "fetch"]);
const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

// Client calls known to be missing from the spec, keyed "METHOD path" (path
// params shown as {}; "*" = method not statically known). Each needs a
// reason; an entry that no longer matches a missing call fails the test, so
// fix the call (or the gateway) and delete the entry.
const NOT_YET_PUBLISHED =
  "email password reset (minderhq/minder#2169, merged): in the gateway's own " +
  "spec, not yet in the published docs copy this test checks against";
const KNOWN_MISSING: Record<string, string> = {
  "GET /v1/auth/capabilities": NOT_YET_PUBLISHED,
  "POST /v1/auth/password-reset/request": NOT_YET_PUBLISHED,
  "POST /v1/auth/password-reset/confirm": NOT_YET_PUBLISHED,
};

interface Route {
  segments: string[];
  catchAll: boolean;
  methods: Set<string>;
}

interface Call {
  file: string;
  line: number;
  method: string | null;
  path: string;
}

function specRoutes(spec: { paths: Record<string, Record<string, unknown>> }): Route[] {
  return Object.entries(spec.paths).map(([path, item]) => {
    const segments = path.split("/").slice(1);
    return {
      segments,
      // FastAPI's `{path:path}` catch-all is published as a trailing `{path}`.
      catchAll: segments[segments.length - 1] === "{path}",
      methods: new Set(
        Object.keys(item)
          .filter((m) => HTTP_METHODS.includes(m))
          .map((m) => m.toUpperCase()),
      ),
    };
  });
}

/** Normalises a client path: query/hash dropped, every segment with an
 * interpolation becomes `{}`, a trailing slash (a concatenation prefix) too. */
function normalizeClientPath(raw: string): string {
  const path = raw.split(/[?#]/)[0];
  const segments = path
    .split("/")
    .slice(1)
    .map((s, i, all) =>
      s.includes(PLACEHOLDER) || (s === "" && i === all.length - 1) ? PLACEHOLDER : s,
    );
  return "/" + segments.join("/");
}

function segmentMatches(spec: string, client: string): boolean {
  if (spec.startsWith("{")) return client !== "";
  return spec === client;
}

/** Spec routes whose path matches the (normalised) client path. */
function matchingRoutes(routes: Route[], path: string): Route[] {
  const client = path.split("/").slice(1);
  return routes.filter((r) => {
    const n = r.segments.length;
    if (r.catchAll ? client.length < n : client.length !== n) return false;
    return r.segments.every((s, i) => segmentMatches(s, client[i]));
  });
}

/** null when the call is served by the spec, else why not. */
function checkCall(routes: Route[], method: string | null, path: string): string | null {
  const hits = matchingRoutes(routes, path);
  if (hits.length === 0) return "no such path in the gateway spec";
  if (method && !hits.some((r) => r.methods.has(method))) {
    const allowed = [...new Set(hits.flatMap((r) => [...r.methods]))].sort().join(", ");
    return `method not served (spec allows ${allowed})`;
  }
  return null;
}

/** Literal text with each `${...}` replaced by PLACEHOLDER; a leading
 * `${apiBaseUrl}` (raw fetch calls) is dropped. */
function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return null;
  let text = node.head.text;
  node.templateSpans.forEach((span, i) => {
    const base =
      i === 0 && text === "" && ts.isIdentifier(span.expression) &&
      span.expression.text === "apiBaseUrl";
    text += (base ? "" : PLACEHOLDER) + span.literal.text;
  });
  return text;
}

function callMethod(call: ts.CallExpression): string | null {
  const opts = call.arguments[1];
  if (!opts) return "GET";
  if (!ts.isObjectLiteralExpression(opts)) return null;
  for (const prop of opts.properties) {
    if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === "method") return null;
    if (!ts.isPropertyAssignment(prop) || prop.name.getText() !== "method") continue;
    const v = prop.initializer;
    return ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)
      ? v.text.toUpperCase()
      : null;
  }
  // A spread (`...init`) may carry a method.
  return opts.properties.some(ts.isSpreadAssignment) ? null : "GET";
}

function collectCalls(file: string, source: string): Call[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const calls: Call[] = [];
  const visit = (node: ts.Node) => {
    const text = literalText(node);
    if (text !== null && text.startsWith("/v1/")) {
      const parent = node.parent;
      let method: string | null = null;
      if (
        parent && ts.isCallExpression(parent) && parent.arguments[0] === node &&
        ts.isIdentifier(parent.expression) && FETCHERS.has(parent.expression.text)
      ) {
        method = callMethod(parent);
      }
      const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      calls.push({ file, line, method, path: normalizeClientPath(text) });
      return; // nested spans of this template are part of the same path
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return calls;
}

const routes = specRoutes(JSON.parse(specText));
const sources = import.meta.glob<string>(
  ["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}", "!../test/**", "!./api-types.gen.ts"],
  { query: "?raw", import: "default", eager: true },
);

describe("API contract (gateway OpenAPI spec)", () => {
  const calls = Object.entries(sources).flatMap(([file, src]) =>
    collectCalls(file.replace(/^\.\//, "src/lib/").replace(/^\.\.\//, "src/"), src),
  );

  it("finds the client's API calls", () => {
    expect(calls.length).toBeGreaterThan(100);
    expect(calls.some((c) => c.method === "POST")).toBe(true);
  });

  it("every client call exists in the spec", () => {
    const missing = new Map<string, string[]>();
    for (const c of calls) {
      const why = checkCall(routes, c.method, c.path);
      if (!why) continue;
      const key = `${c.method ?? "*"} ${c.path}`;
      if (!missing.has(key)) missing.set(key, []);
      missing.get(key)!.push(`${c.file}:${c.line} (${why})`);
    }
    const unexpected = [...missing].filter(([k]) => !(k in KNOWN_MISSING));
    const stale = Object.keys(KNOWN_MISSING).filter((k) => !missing.has(k));
    expect(
      unexpected.map(([k, where]) => `${k} -- ${where.join("; ")}`),
      "client calls a route the gateway doesn't serve (fix the call, or sync " +
        "openapi/api-gateway.json if the gateway changed)",
    ).toEqual([]);
    expect(stale, "KNOWN_MISSING entries that now resolve: delete them").toEqual([]);
  });
});

describe("contract matcher", () => {
  const r = specRoutes({
    paths: {
      "/v1/teams/{team_id}": { get: {}, patch: {} },
      "/v1/rag/{path}": { get: {}, post: {} },
      "/v1/organizations/mine": { get: {} },
    },
  });

  it("matches params, catch-alls and methods", () => {
    expect(checkCall(r, "GET", normalizeClientPath("/v1/teams/{}"))).toBeNull();
    expect(checkCall(r, "POST", "/v1/rag/pipeline/{}/query")).toBeNull();
    expect(checkCall(r, null, "/v1/organizations/mine")).toBeNull();
    expect(checkCall(r, "GET", "/v1/rag")).toMatch(/no such path/);
    expect(checkCall(r, "GET", "/v1/nope")).toMatch(/no such path/);
    expect(checkCall(r, "DELETE", "/v1/teams/{}")).toMatch(/GET, PATCH/);
    // A dynamic client segment never matches a literal spec segment.
    expect(checkCall(r, "GET", "/v1/organizations/{}")).toMatch(/no such path/);
  });

  it("extracts paths and methods from source", () => {
    const calls = collectCalls(
      "x.ts",
      'apiFetch(`/v1/teams/${id}?a=1`, { token, method: "PATCH" });\n' +
        "fetch(`${apiBaseUrl}/v1/auth/login`, { method: 'POST' });\n" +
        'const p = "/v1/rag/";\napiFetch(path, { method: "DELETE" });\n',
    );
    expect(calls.map((c) => [c.method, c.path, c.line])).toEqual([
      ["PATCH", "/v1/teams/{}", 1],
      ["POST", "/v1/auth/login", 2],
      [null, "/v1/rag/{}", 3],
    ]);
  });
});
