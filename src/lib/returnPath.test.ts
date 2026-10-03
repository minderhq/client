import { afterEach, describe, expect, it } from "vitest";

import { consumeReturnPath, rememberReturnPath, safeReturnPath } from "./returnPath";

describe("returnPath", () => {
  afterEach(() => sessionStorage.clear());

  it("accepts in-app paths only", () => {
    expect(safeReturnPath("/invite/abc")).toBe("/invite/abc");
    expect(safeReturnPath("//evil.example.com")).toBeNull();
    expect(safeReturnPath("/\\evil.example.com")).toBeNull();
    expect(safeReturnPath("https://evil.example.com")).toBeNull();
    expect(safeReturnPath(undefined)).toBeNull();
  });

  it("remembers a path once", () => {
    rememberReturnPath("/invite/abc");
    expect(consumeReturnPath()).toBe("/invite/abc");
    expect(consumeReturnPath()).toBeNull();
  });

  it("clears any old path when there's nothing to remember", () => {
    rememberReturnPath("/invite/abc");
    rememberReturnPath(null);
    expect(consumeReturnPath()).toBeNull();
  });
});
