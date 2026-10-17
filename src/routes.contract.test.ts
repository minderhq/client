/**
 * Route ↔ nav contract (client#126).
 *
 * Every route the router declares (the <Route path=…> elements in App.tsx)
 * must be classified: a nav destination (sidebar entry or in-page tab), a
 * detail page under one, an auth/utility route, or a redirect. Every nav
 * entry must point at a declared route. Adding a page without classifying it
 * here -- or a nav entry without a route -- fails this test.
 *
 * App.tsx declares its routes inline as JSX, so they are read from its source
 * with the TypeScript parser: every `<Route>` element, whatever the order of
 * its attributes. A `<Route>` without a `path`, or a `path` expression this
 * file can't resolve, fails too, rather than being skipped.
 */
import ts from "typescript";
import { describe, expect, it } from "vitest";

import appSource from "./App.tsx?raw";
import { NAV_SECTIONS } from "./lib/nav";
import { ORG_USERS_PATH } from "./lib/orgs";
import { LEGACY_REDIRECTS, ROUTES, SECTION_REDIRECTS } from "./lib/routes";

/** Pages reached through a nav destination rather than from the nav itself,
 * keyed by path → the nav destination that owns them. */
const DETAIL_ROUTES: Record<string, string> = {
  "/rag/public-chat/:endpointId/conversations": "/rag/public-chat",
  "/rag/public-chat/:endpointId/conversations/:sessionId": "/rag/public-chat",
  [`${ROUTES.sources}/:repositoryId`]: ROUTES.sources,
};

/** Sign-in, account-recovery and invite pages: deliberately not in the nav. */
const AUTH_ROUTES = [
  "/login",
  "/auth/callback",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/invite/:token",
];

/** Routes outside the main nav for another stated reason. */
const UTILITY_ROUTES: Record<string, string> = {
  "/settings": "your own account settings, reached from the user menu",
  "*": "unmatched paths redirect home",
};

/** The JSX expression in `path={…}` that maps the redirect tables to routes;
 * those paths are checked against SECTION_REDIRECTS / LEGACY_REDIRECTS. */
const REDIRECT_TABLE_EXPRESSION = "from";

/** Resolve a `path={expr}` expression from App.tsx to its string value. */
function resolvePathExpression(expr: string): string | null {
  const scope: Record<string, string> = { ORG_USERS_PATH };
  for (const [key, value] of Object.entries(ROUTES)) scope[`ROUTES.${key}`] = value;
  const template = /^`(.*)`$/.exec(expr);
  if (template) {
    let unresolved = false;
    const value = template[1].replace(/\$\{([^}]+)\}/g, (_, name: string) => {
      const v = scope[name.trim()];
      if (v === undefined) unresolved = true;
      return v ?? "";
    });
    return unresolved ? null : value;
  }
  return scope[expr] ?? null;
}

interface DeclaredRoutes {
  paths: string[];
  unresolved: string[];
  redirectTableMapped: boolean;
}

/** Every `<Route>` element in App.tsx (self-closing or not), its `path`
 * attribute resolved, found by walking the parsed JSX tree. */
function declaredRoutes(source: string): DeclaredRoutes {
  const paths: string[] = [];
  const unresolved: string[] = [];
  let redirectTableMapped = false;
  const sf = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  function visitRoute(el: ts.JsxSelfClosingElement | ts.JsxOpeningElement) {
    const pathAttr = el.attributes.properties.find(
      (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(sf) === "path",
    );
    const init = pathAttr?.initializer;
    if (!init) {
      unresolved.push(`<Route> without a path at line ${sf.getLineAndCharacterOfPosition(el.getStart(sf)).line + 1}`);
      return;
    }
    if (ts.isStringLiteral(init)) {
      paths.push(init.text);
      return;
    }
    const expr = ts.isJsxExpression(init) ? init.expression : undefined;
    if (!expr) {
      unresolved.push(init.getText(sf));
      return;
    }
    if (ts.isNoSubstitutionTemplateLiteral(expr) || ts.isStringLiteral(expr)) {
      paths.push(expr.text);
      return;
    }
    const text = expr.getText(sf).trim();
    if (text === REDIRECT_TABLE_EXPRESSION) {
      redirectTableMapped = true;
      return;
    }
    const value = resolvePathExpression(text);
    if (value === null) unresolved.push(text);
    else paths.push(value);
  }

  function visit(node: ts.Node) {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      node.tagName.getText(sf) === "Route"
    ) {
      visitRoute(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return { paths, unresolved, redirectTableMapped };
}

/** Every nav destination: sidebar entries and their in-page tabs. */
const NAV_PATHS = [
  ...new Set(NAV_SECTIONS.flatMap((s) => s.items).flatMap((i) => [i.to, ...(i.tabs ?? []).map((t) => t.to)])),
];

const REDIRECTS = [...SECTION_REDIRECTS, ...LEGACY_REDIRECTS];

const declared = declaredRoutes(appSource);
const routeSet = new Set(declared.paths);

/** Does a concrete path (or a param pattern) hit a declared route? */
function matchesDeclared(path: string): boolean {
  if (routeSet.has(path)) return true;
  const segs = path.split("/");
  return declared.paths.some((route) => {
    const rs = route.split("/");
    return rs.length === segs.length && rs.every((r, i) => r.startsWith(":") || r === segs[i]);
  });
}

describe("routes contract", () => {
  it("reads the router's routes from App.tsx", () => {
    expect(declared.unresolved).toEqual([]);
    expect(declared.redirectTableMapped).toBe(true);
    // A sanity floor, so a regex that silently stops matching can't pass.
    expect(declared.paths.length).toBeGreaterThan(30);
    expect(declared.paths).toContain("/");
    expect(declared.paths).toContain(ROUTES.sources);
  });

  it("declares each route once", () => {
    const dupes = declared.paths.filter((p, i) => declared.paths.indexOf(p) !== i);
    expect(dupes).toEqual([]);
  });

  it("classifies every declared route", () => {
    const classified = new Set([
      ...NAV_PATHS,
      ...Object.keys(DETAIL_ROUTES),
      ...AUTH_ROUTES,
      ...Object.keys(UTILITY_ROUTES),
    ]);
    const unclassified = declared.paths.filter((p) => !classified.has(p));
    // A new page? Add it to nav.ts, or to DETAIL_ROUTES / AUTH_ROUTES /
    // UTILITY_ROUTES above with the reason it stays out of the nav.
    expect(unclassified).toEqual([]);
  });

  it("points every nav entry and tab at a declared route", () => {
    expect(NAV_PATHS.filter((p) => !routeSet.has(p))).toEqual([]);
  });

  it("keeps the classification lists free of routes that no longer exist", () => {
    const stale = [...Object.keys(DETAIL_ROUTES), ...AUTH_ROUTES, ...Object.keys(UTILITY_ROUTES)].filter(
      (p) => !routeSet.has(p),
    );
    expect(stale).toEqual([]);
  });

  it("nests every detail route under a nav destination it extends", () => {
    for (const [detail, parent] of Object.entries(DETAIL_ROUTES)) {
      expect(NAV_PATHS, detail).toContain(parent);
      expect(detail.startsWith(`${parent}/`), detail).toBe(true);
    }
  });

  it("keeps auth, utility and detail routes out of the nav", () => {
    const outside = [...AUTH_ROUTES, ...Object.keys(UTILITY_ROUTES), ...Object.keys(DETAIL_ROUTES)];
    expect(outside.filter((p) => NAV_PATHS.includes(p))).toEqual([]);
  });

  it("never lets a redirect shadow a real route", () => {
    expect(REDIRECTS.map((r) => r.from).filter((from) => routeSet.has(from))).toEqual([]);
  });

  it("lands every redirect on a declared route", () => {
    expect(REDIRECTS.filter((r) => !matchesDeclared(r.to)).map((r) => `${r.from} → ${r.to}`)).toEqual([]);
  });
});
