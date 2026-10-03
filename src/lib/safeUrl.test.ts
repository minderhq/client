import { describe, expect, it } from "vitest";

import { safeExternalUrl } from "./safeUrl";

describe("safeExternalUrl", () => {
  it.each([
    ["https://github.com/acme/weather", "https://github.com/acme/weather"],
    ["http://git.internal:3000/acme/weather", "http://git.internal:3000/acme/weather"],
    ["  https://example.com/x  ", "https://example.com/x"],
    ["HTTPS://Example.com/Repo", "https://example.com/Repo"],
  ])("keeps the http(s) URL %j", (raw, expected) => {
    expect(safeExternalUrl(raw)).toBe(expected);
  });

  it.each([
    "javascript:alert(1)",
    " JavaScript:alert(document.cookie)",
    "java\tscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "ftp://example.com/repo",
    "mailto:dev@example.com",
    "//evil.example.com/path",
    "/relative/path",
    "github.com/acme/weather",
    "not a url",
    "",
    "   ",
  ])("rejects %j", (raw) => {
    expect(safeExternalUrl(raw)).toBeNull();
  });

  it("rejects null, undefined and non-strings", () => {
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
    expect(safeExternalUrl(42 as unknown as string)).toBeNull();
  });
});
