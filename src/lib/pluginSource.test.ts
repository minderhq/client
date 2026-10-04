import { describe, expect, it } from "vitest";

import {
  CATALOG_SOURCE_KINDS,
  INSTALLED_SOURCE_KINDS,
  matchesSourceFilter,
  parseSourceFilter,
  resolveCatalogSource,
  serverOriginFilter,
  SOURCE_FILTER_KINDS,
  SOURCE_META,
  sourceFromInstallSource,
  sourceFromOrigin,
  type SourceKind,
} from "./pluginSource";

describe("sourceFromInstallSource", () => {
  it.each([
    ["vendored", "first_party"],
    ["git", "private_git"],
    ["manifest", "manifest"],
  ] as const)("maps install_source=%s to %s", (value, kind) => {
    expect(sourceFromInstallSource(value)).toBe(kind);
  });

  it.each([null, undefined, "", "mindhub", "Vendored", "constructor", "__proto__", 1, {}])(
    "gives no badge for %s (null, unknown, reserved or not a string)",
    (value) => {
      expect(sourceFromInstallSource(value)).toBeNull();
    },
  );
});

describe("sourceFromOrigin / resolveCatalogSource", () => {
  it("maps origin first_party → First-party and submitted → Submitted", () => {
    expect(sourceFromOrigin("first_party")).toBe("first_party");
    expect(sourceFromOrigin("submitted")).toBe("submitted");
    expect(resolveCatalogSource({ origin: "first_party" })).toBe("first_party");
    expect(resolveCatalogSource({ origin: "submitted" })).toBe("submitted");
  });

  it("ignores repository_url entirely (no URL heuristic)", () => {
    const rows = [
      { origin: "first_party", repository_url: "https://git.example.com/team/plugin" },
      { origin: "submitted", repository_url: "https://github.com/minderhq/plugins" },
    ];
    expect(rows.map(resolveCatalogSource)).toEqual(["first_party", "submitted"]);
    expect(resolveCatalogSource({ repository_url: "https://github.com/acme/plugin" } as never)).toBeNull();
  });

  it("returns null (no badge) for a missing, null or unknown origin", () => {
    expect(resolveCatalogSource(null)).toBeNull();
    expect(resolveCatalogSource(undefined)).toBeNull();
    expect(resolveCatalogSource({})).toBeNull();
    expect(resolveCatalogSource({ origin: null })).toBeNull();
    expect(resolveCatalogSource({ origin: "something_new" })).toBeNull();
    expect(sourceFromOrigin("hasOwnProperty")).toBeNull();
  });

  it("never resolves to the reserved MindHub source (Phase 2)", () => {
    for (const v of ["first_party", "submitted", "mindhub", "vendored", "git", "manifest", undefined]) {
      expect(resolveCatalogSource({ origin: v })).not.toBe("mindhub");
      expect(sourceFromInstallSource(v)).not.toBe("mindhub");
    }
  });
});

describe("source kinds per view", () => {
  it("explains on Installed every kind an install can have, MindHub still reserved", () => {
    expect(INSTALLED_SOURCE_KINDS).toEqual(["first_party", "private_git", "manifest", "submitted"]);
  });

  it("limits Discover to the kinds a catalog row can have", () => {
    expect(CATALOG_SOURCE_KINDS).toEqual(["first_party", "submitted"]);
  });
});

describe("source filter", () => {
  it("offers All + First-party / Submitted (what a catalog row can be), not MindHub yet", () => {
    expect(SOURCE_FILTER_KINDS).toEqual(["first_party", "submitted"]);
  });

  it("maps each offered filter to the server-side origin param", () => {
    expect(serverOriginFilter("first_party")).toBe("first_party");
    expect(serverOriginFilter("submitted")).toBe("submitted");
    expect(serverOriginFilter(null)).toBeNull();
    // Install-only kinds have no catalog origin to filter by.
    expect(serverOriginFilter("private_git")).toBeNull();
    expect(serverOriginFilter("manifest")).toBeNull();
    expect(serverOriginFilter("mindhub")).toBeNull();
  });

  it("round-trips each filter through its URL value", () => {
    for (const kind of SOURCE_FILTER_KINDS) {
      expect(parseSourceFilter(SOURCE_META[kind].param)).toBe(kind);
    }
    expect(SOURCE_FILTER_KINDS.map((k) => SOURCE_META[k].param)).toEqual([
      "first-party",
      "submitted",
    ]);
  });

  it("treats a missing, unknown or not-yet-offered value as All", () => {
    expect(parseSourceFilter(null)).toBeNull();
    expect(parseSourceFilter("")).toBeNull();
    expect(parseSourceFilter("bogus")).toBeNull();
    expect(parseSourceFilter("first_party")).toBeNull(); // the kind, not the URL value
    expect(parseSourceFilter("mindhub")).toBeNull();
    expect(parseSourceFilter("manifest")).toBeNull();
  });

  it("opens an old #2193 ?source=private link on All (regression)", () => {
    // A catalog row is never a git install (#2219), so Private git is no
    // longer a Discover filter; its old value must not select anything.
    expect(SOURCE_META.private_git.param).toBe("private");
    expect(parseSourceFilter("private")).toBeNull();
    expect(serverOriginFilter(parseSourceFilter("private"))).toBeNull();
  });

  it("matches everything under All, and only the selected source otherwise", () => {
    const kinds: (SourceKind | null)[] = ["first_party", "private_git", "manifest", "submitted", null];
    for (const k of kinds) expect(matchesSourceFilter(k, null)).toBe(true);
    expect(matchesSourceFilter("first_party", "first_party")).toBe(true);
    expect(matchesSourceFilter("submitted", "first_party")).toBe(false);
    expect(matchesSourceFilter(null, "first_party")).toBe(false);
  });
});
