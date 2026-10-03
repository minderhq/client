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

  describe("parser-normalization tricks", () => {
    it.each([
      // C0 controls: leading ones are stripped by the parser, tabs/newlines
      // anywhere are removed -- either way the scheme is still javascript:.
      ["leading NUL", "\u0000javascript:alert(1)"],
      ["leading control char", "\u0001javascript:alert(1)"],
      ["newline inside the scheme", "java\nscript:alert(1)"],
      ["carriage return inside the scheme", "java\rscript:alert(1)"],
      // Percent-encoding isn't decoded in a scheme: this is a relative path.
      ["percent-encoded scheme letter", "%6Aavascript:alert(1)"],
      // Not whitespace to the URL parser, so the "scheme" is invalid.
      ["zero-width space prefix", "\u200Bjavascript:alert(1)"],
      ["zero-width space before https", "\u200Bhttps://example.com"],
      // String#trim strips these, which still leaves javascript:.
      ["no-break space prefix", "\u00A0javascript:alert(1)"],
      ["BOM prefix", "\uFEFFjavascript:alert(1)"],
      ["upper-case DATA:", "DATA:text/html,<script>alert(1)</script>"],
      ["blob:", "blob:https://example.com/0b5c1d2e-7f00-4a3b-9c8d-1e2f3a4b5c6d"],
      ["backslash-only host (relative)", "\\\\evil.example.com\\path"],
    ])("rejects %s", (_label, raw) => {
      expect(safeExternalUrl(raw)).toBeNull();
    });

    it("normalizes backslashes in a special-scheme URL, so the shown URL is the real one", () => {
      expect(safeExternalUrl("https:\\\\evil.example.com\\path")).toBe(
        "https://evil.example.com/path",
      );
    });

    it("removes a newline inside an http URL rather than letting it hide anything", () => {
      expect(safeExternalUrl("https://exa\nmple.com/repo")).toBe("https://example.com/repo");
    });
  });

  describe("userinfo (credentials) is never linked", () => {
    it.each([
      ["user and password", "https://user:pass@example.com/repo"],
      ["username only", "https://user@example.com/repo"],
      ["password only", "https://:pass@example.com/repo"],
      // The tab is dropped by the parser: "example.com" becomes the username
      // and the real host is evil.com.
      ["tab-hidden host spoof", "https://example.com\t@evil.com"],
      ["lookalike host spoof", "https://github.com@evil.example.com/acme/weather"],
    ])("rejects %s", (_label, raw) => {
      expect(safeExternalUrl(raw)).toBeNull();
    });
  });

  it("rejects null, undefined and non-strings", () => {
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
    expect(safeExternalUrl(42 as unknown as string)).toBeNull();
  });
});
