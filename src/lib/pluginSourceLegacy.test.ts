import { describe, expect, it } from "vitest";

import { isFirstPartyCatalogUrl, legacyCatalogRowSource } from "./pluginSourceLegacy";

// The pre-#2219 heuristic, kept only for backends without install_source /
// marketplace_plugin_id / installation origin. Behaviour pinned unchanged.
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

describe("legacyCatalogRowSource", () => {
  it("maps origin=first_party with no repository to First-party", () => {
    expect(legacyCatalogRowSource({ origin: "first_party", repository_url: null })).toBe("first_party");
  });

  it("keeps a first-party row that links the first-party catalog repo First-party", () => {
    expect(
      legacyCatalogRowSource({
        origin: "first_party",
        repository_url: "https://github.com/minderhq/plugins/tree/main/weather",
      }),
    ).toBe("first_party");
  });

  it("maps a repository outside the first-party catalog to Private git", () => {
    expect(
      legacyCatalogRowSource({ origin: "first_party", repository_url: "https://git.example.com/team/plugin" }),
    ).toBe("private_git");
    // even with no origin at all
    expect(legacyCatalogRowSource({ repository_url: "https://github.com/acme/plugin" })).toBe("private_git");
  });

  it("maps origin=submitted to Submitted, whatever repository it links", () => {
    expect(legacyCatalogRowSource({ origin: "submitted", repository_url: null })).toBe("submitted");
    expect(
      legacyCatalogRowSource({ origin: "submitted", repository_url: "https://github.com/someone/plugin" }),
    ).toBe("submitted");
  });

  it("returns null (no badge) when there's nothing to classify by", () => {
    expect(legacyCatalogRowSource(null)).toBeNull();
    expect(legacyCatalogRowSource(undefined)).toBeNull();
    expect(legacyCatalogRowSource({})).toBeNull();
    expect(legacyCatalogRowSource({ origin: "something_new", repository_url: "  " })).toBeNull();
  });

  it("never resolves to the reserved MindHub source (Phase 2)", () => {
    for (const origin of ["first_party", "submitted", "mindhub", undefined]) {
      expect(legacyCatalogRowSource({ origin, repository_url: null })).not.toBe("mindhub");
    }
  });
});

