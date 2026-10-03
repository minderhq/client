import { describe, expect, it } from "vitest";

import {
  isFirstPartyCatalogUrl,
  matchesSourceFilter,
  parseSourceFilter,
  resolveSource,
  SOURCE_FILTER_KINDS,
  SOURCE_META,
  type SourceKind,
} from "./pluginSource";

describe("isFirstPartyCatalogUrl", () => {
  it.each([
    "https://github.com/minderhq/plugins",
    "https://github.com/minderhq/plugins/",
    "https://github.com/minderhq/plugins.git",
    "https://www.github.com/MinderHQ/Plugins",
    "https://github.com/minderhq/plugins/tree/main/weather",
    "  https://github.com/minderhq/plugins  ",
  ])("recognises %s as the first-party catalog", (url) => {
    expect(isFirstPartyCatalogUrl(url)).toBe(true);
  });

  it.each([
    "https://github.com/acme/plugins",
    "https://github.com/minderhq/plugins-extra",
    "https://gitlab.com/minderhq/plugins",
    "https://github.com.evil.example/minderhq/plugins",
    "https://github.com/minderhq",
    "not a url",
    "",
  ])("does not treat %s as the first-party catalog", (url) => {
    expect(isFirstPartyCatalogUrl(url)).toBe(false);
  });
});

describe("resolveSource", () => {
  it("maps origin=first_party with no repository to First-party", () => {
    expect(resolveSource({ origin: "first_party", repository_url: null })).toBe("first_party");
  });

  it("keeps a first-party row that links the first-party catalog repo First-party", () => {
    expect(
      resolveSource({
        origin: "first_party",
        repository_url: "https://github.com/minderhq/plugins/tree/main/weather",
      }),
    ).toBe("first_party");
  });

  it("maps a repository outside the first-party catalog to Private git", () => {
    expect(
      resolveSource({ origin: "first_party", repository_url: "https://git.example.com/team/plugin" }),
    ).toBe("private_git");
    // even with no origin at all
    expect(resolveSource({ repository_url: "https://github.com/acme/plugin" })).toBe("private_git");
  });

  it("maps origin=submitted to Submitted, whatever repository it links", () => {
    expect(resolveSource({ origin: "submitted", repository_url: null })).toBe("submitted");
    expect(
      resolveSource({ origin: "submitted", repository_url: "https://github.com/someone/plugin" }),
    ).toBe("submitted");
  });

  it("returns null (no badge) when there's nothing to classify by", () => {
    expect(resolveSource(null)).toBeNull();
    expect(resolveSource(undefined)).toBeNull();
    expect(resolveSource({})).toBeNull();
    expect(resolveSource({ origin: "something_new", repository_url: "  " })).toBeNull();
  });

  it("never resolves to the reserved MindHub source (Phase 2)", () => {
    for (const origin of ["first_party", "submitted", "mindhub", undefined]) {
      expect(resolveSource({ origin, repository_url: null })).not.toBe("mindhub");
    }
  });
});

describe("source filter", () => {
  it("offers All + First-party / Private git / Submitted, not MindHub yet", () => {
    expect(SOURCE_FILTER_KINDS).toEqual(["first_party", "private_git", "submitted"]);
  });

  it("round-trips each filter through its URL value", () => {
    for (const kind of SOURCE_FILTER_KINDS) {
      expect(parseSourceFilter(SOURCE_META[kind].param)).toBe(kind);
    }
    expect(SOURCE_FILTER_KINDS.map((k) => SOURCE_META[k].param)).toEqual([
      "first-party",
      "private",
      "submitted",
    ]);
  });

  it("treats a missing, unknown or not-yet-offered value as All", () => {
    expect(parseSourceFilter(null)).toBeNull();
    expect(parseSourceFilter("")).toBeNull();
    expect(parseSourceFilter("bogus")).toBeNull();
    expect(parseSourceFilter("first_party")).toBeNull(); // the kind, not the URL value
    expect(parseSourceFilter("mindhub")).toBeNull();
  });

  it("matches everything under All, and only the selected source otherwise", () => {
    const kinds: (SourceKind | null)[] = ["first_party", "private_git", "submitted", null];
    for (const k of kinds) expect(matchesSourceFilter(k, null)).toBe(true);
    expect(matchesSourceFilter("first_party", "first_party")).toBe(true);
    expect(matchesSourceFilter("submitted", "first_party")).toBe(false);
    expect(matchesSourceFilter(null, "first_party")).toBe(false);
  });
});
