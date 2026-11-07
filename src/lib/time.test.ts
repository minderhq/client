import { describe, expect, it } from "vitest";

import { formatServerTime, parseServerTimestamp } from "./time";

describe("server times (#148)", () => {
  it("reads an offset-less timestamp as UTC, not local time", () => {
    expect(parseServerTimestamp("2026-11-07T11:16:02")?.getTime()).toBe(
      Date.UTC(2026, 10, 7, 11, 16, 2),
    );
    expect(formatServerTime("2026-11-07T11:16:02")).toBe(
      new Date(Date.UTC(2026, 10, 7, 11, 16, 2)).toLocaleString(),
    );
  });

  it("keeps an explicit offset, and falls back when missing or invalid", () => {
    expect(parseServerTimestamp("2026-11-07T14:16:02+03:00")?.getTime()).toBe(
      Date.UTC(2026, 10, 7, 11, 16, 2),
    );
    expect(formatServerTime(null)).toBe("—");
    expect(formatServerTime("nope", "nope")).toBe("nope");
  });
});

describe("date-only server values (#148)", () => {
  it("leaves a date-only string as the UTC date JS already reads it as", () => {
    expect(parseServerTimestamp("2026-11-07")?.getTime()).toBe(Date.UTC(2026, 10, 7));
  });
});
