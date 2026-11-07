import { describe, expect, it } from "vitest";

import { absoluteUrl } from "./links";

describe("absoluteUrl", () => {
  it("resolves a same-origin base against the page origin", () => {
    expect(absoluteUrl("/api", "https://minder.example.com")).toBe(
      "https://minder.example.com/api",
    );
  });

  it("keeps an absolute base and drops a trailing slash", () => {
    expect(absoluteUrl("https://gw.example.com/", "https://minder.example.com")).toBe(
      "https://gw.example.com",
    );
  });

  it("defaults to the current page origin", () => {
    expect(absoluteUrl("/api")).toBe(`${window.location.origin}/api`);
  });
});
