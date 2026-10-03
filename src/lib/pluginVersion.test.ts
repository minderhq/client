import { describe, expect, it } from "vitest";

import { compareVersions, formatVersion, normalizeVersion, versionHint } from "./pluginVersion";

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
  ])("orders %s vs %s", (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b)!)).toBe(sign);
  });

  it("returns null when the two can't be ordered", () => {
    expect(compareVersions("latest", "1.0.0")).toBeNull();
    expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBeNull();
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
    expect(versionHint("2026.01-a", "2026.01-b")).toEqual({ kind: "different", listed: "2026.01-b" });
    expect(versionHint("nightly", "1.0.0")).toEqual({ kind: "different", listed: "1.0.0" });
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
