import { describe, expect, it } from "vitest";

import { orgRoleTone, slugify } from "./orgs";

describe("slugify", () => {
  it("lowercases and hyphenates spaces and specials", () => {
    expect(slugify("My Org")).toBe("my-org");
    expect(slugify("a@b#c")).toBe("a-b-c");
  });

  it("trims leading/trailing whitespace and separators", () => {
    expect(slugify("  ---Trim---  ")).toBe("trim");
  });

  it("keeps the allowed non-alphanumerics . _ -", () => {
    expect(slugify("a.b_c-d")).toBe("a.b_c-d");
  });

  it("caps the length at 100", () => {
    expect(slugify("x".repeat(150))).toHaveLength(100);
  });

  it("always yields the backend-allowed charset, incl. non-ASCII input", () => {
    // must satisfy the backend handle rule ^[a-zA-Z0-9._-]+$ (lowercased here)
    for (const name of [
      "İstanbul Şirket",
      "Ör.nek_Firma!",
      "日本語",
      "  ",
      "ABC 123",
    ]) {
      expect(slugify(name)).toMatch(/^[a-z0-9._-]*$/);
    }
  });
});

describe("orgRoleTone", () => {
  it("gives owner/admin/member distinct tones and defaults to neutral", () => {
    expect(orgRoleTone("owner")).toContain("indigo");
    expect(orgRoleTone("admin")).toContain("amber");
    expect(orgRoleTone("member")).toContain("gray");
    expect(orgRoleTone("something-else")).toContain("gray");
  });
});
