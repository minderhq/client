import { describe, expect, it } from "vitest";

import {
  compareVersions,
  formatVersion,
  isPrerelease,
  normalizeVersion,
  versionHint,
} from "./pluginVersion";

describe("compareVersions", () => {
  it.each([
    ["1.0.0", "1.0.1", -1],
    ["1.10.0", "1.9.9", 1],
    ["2.0.0", "2.0.0", 0],
    ["1.2", "1.2.0", 0],
    ["v1.2.0", "1.2.0", 0],
    ["1.0.0+build.5", "1.0.0", 0],
    ["1.0.0", "1.0.0-rc.1", 1],
    ["1.0.0-rc.1", "1.0.0", -1],
    // uppercase prefix
    ["V1.2.0", "1.2.0", 0],
    ["V2.0.0", "v1.9.0", 1],
    // semver pre-release precedence (same core)
    ["1.0.0-alpha", "1.0.0-beta", -1],
    ["1.0.0-rc.1", "1.0.0-rc.2", -1],
    ["1.0.0-rc.2", "1.0.0-rc.10", -1], // numeric ids compare numerically
    ["1.0.0-alpha", "1.0.0-alpha.1", -1], // a shorter prefix ranks lower
    ["1.0.0-alpha.1", "1.0.0-alpha.beta", -1], // numeric < alphanumeric
    ["1.0.0-beta.11", "1.0.0-rc.1", -1],
    ["1.0.0-rc.1", "1.0.0-rc.1", 0],
    // the full chain from semver §11.4
    ["1.0.0-beta", "1.0.0-beta.2", -1],
    ["1.0.0-beta.2", "1.0.0-beta.11", -1],
    // a pre-release of a higher core still beats a lower release
    ["1.1.0-beta", "1.0.0", 1],
  ])("orders %s vs %s", (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b)!)).toBe(sign);
  });

  it("returns null only when a side isn't a version", () => {
    expect(compareVersions("latest", "1.0.0")).toBeNull();
    expect(compareVersions("1.0.0", "nightly")).toBeNull();
    expect(compareVersions("1.0.0-", "1.0.0")).toBeNull();
  });
});

describe("versionHint", () => {
  it("is null when either side is unknown or they match", () => {
    expect(versionHint(null, "1.0.0")).toBeNull();
    expect(versionHint("1.0.0", null)).toBeNull();
    expect(versionHint("1.0.0", "  ")).toBeNull();
    expect(versionHint("1.0.0", "1.0.0")).toBeNull();
    expect(versionHint(" 1.0.0 ", "1.0.0")).toBeNull();
  });

  it("flags a newer listed version", () => {
    expect(versionHint("1.0.0", "1.1.0")).toEqual({ kind: "newer", listed: "1.1.0" });
  });

  it("says nothing when the installed version is the newer one (not an update)", () => {
    expect(versionHint("2.0.0", "1.9.0")).toBeNull();
  });

  it("reports an unorderable difference neutrally", () => {
    expect(versionHint("nightly", "1.0.0")).toEqual({ kind: "different", listed: "1.0.0" });
    expect(versionHint("1.0.0", "latest")).toEqual({ kind: "different", listed: "latest" });
  });

  it("does not offer a pre-release as 'newer' to someone on a stable release", () => {
    expect(versionHint("1.0.0", "1.1.0-beta")).toBeNull();
    expect(versionHint("1.0.0", "2.0.0-rc.1")).toBeNull();
  });

  it("does flag a newer pre-release to someone already on a pre-release", () => {
    expect(versionHint("1.1.0-beta.1", "1.1.0-beta.2")).toEqual({ kind: "newer", listed: "1.1.0-beta.2" });
    expect(versionHint("1.0.0-alpha", "1.0.0-beta")).toEqual({ kind: "newer", listed: "1.0.0-beta" });
  });

  it("flags the release of an installed pre-release", () => {
    expect(versionHint("1.0.0-rc.2", "1.0.0")).toEqual({ kind: "newer", listed: "1.0.0" });
  });

  it("treats an uppercase V prefix as the same version", () => {
    expect(versionHint("V1.2.0", "1.2.0")).toBeNull();
    expect(versionHint("V1.2.0", "1.3.0")).toEqual({ kind: "newer", listed: "1.3.0" });
  });
});

describe("isPrerelease", () => {
  it("detects a pre-release tag and ignores build metadata", () => {
    expect(isPrerelease("1.1.0-beta")).toBe(true);
    expect(isPrerelease("V2.0.0-rc.1")).toBe(true);
    expect(isPrerelease("1.0.0")).toBe(false);
    expect(isPrerelease("1.0.0+build.5")).toBe(false);
    expect(isPrerelease("nightly")).toBe(false);
  });
});

describe("formatting", () => {
  it("prefixes numeric versions with v and leaves others alone", () => {
    expect(formatVersion("1.2.0")).toBe("v1.2.0");
    expect(formatVersion("v1.2.0")).toBe("v1.2.0");
    expect(formatVersion("nightly")).toBe("nightly");
  });

  it("normalizes blanks to null", () => {
    expect(normalizeVersion(undefined)).toBeNull();
    expect(normalizeVersion("")).toBeNull();
    expect(normalizeVersion(" 1.0 ")).toBe("1.0");
  });
});
