import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TOKEN_KEY, TOKEN_REFRESHED_EVENT } from "./api";
import {
  changePassword,
  MAX_PASSWORD_BYTES,
  MIN_PASSWORD_LENGTH,
  newPasswordProblem,
} from "./password";

function respond(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
    headers: new Headers({ "content-type": "application/json" }),
  } as Response;
}

describe("changePassword (#62)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    sessionStorage.clear();
    sessionStorage.setItem(TOKEN_KEY, "old-token");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adopts the replacement token, so this device stays signed in", async () => {
    vi.mocked(fetch).mockResolvedValue(
      respond(200, { access_token: "new-token", token_type: "bearer", expires_in: 900 }),
    );
    const seen: string[] = [];
    const onRefreshed = (e: Event) => seen.push((e as CustomEvent<string>).detail);
    window.addEventListener(TOKEN_REFRESHED_EVENT, onRefreshed);
    try {
      await expect(changePassword("old pass", "new password", "old-token")).resolves.toBe(
        "new-token",
      );
    } finally {
      window.removeEventListener(TOKEN_REFRESHED_EVENT, onRefreshed);
    }
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe("new-token");
    expect(seen).toEqual(["new-token"]);
  });

  it("still accepts an older gateway's 204 with no body", async () => {
    vi.mocked(fetch).mockResolvedValue(respond(204));
    await expect(changePassword("a", "b", "old-token")).resolves.toBe("old-token");
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe("old-token");
  });

  it("doesn't resurrect a session that moved on meanwhile", async () => {
    vi.mocked(fetch).mockImplementation(async () => {
      sessionStorage.setItem(TOKEN_KEY, "switched-org-token");
      return respond(200, { access_token: "new-token" });
    });
    await expect(changePassword("a", "b", "old-token")).resolves.toBe(
      "switched-org-token",
    );
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe("switched-org-token");
  });
});

describe("newPasswordProblem", () => {
  it("accepts a password of 8 to 72 bytes that matches its confirmation", () => {
    expect(newPasswordProblem("abcdefgh", "abcdefgh")).toBeNull();
    expect(newPasswordProblem("a".repeat(MAX_PASSWORD_BYTES), "a".repeat(72))).toBeNull();
  });

  it("enforces the minimum length, counting code points like the gateway", () => {
    expect(newPasswordProblem("short", "short")).toEqual({
      field: "password",
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    });
    // Four emoji are 8 UTF-16 units but 4 characters to the gateway.
    expect(newPasswordProblem("😀😀😀😀", "😀😀😀😀")?.field).toBe("password");
  });

  it("refuses more than 72 UTF-8 bytes, as bcrypt does", () => {
    expect(newPasswordProblem("a".repeat(73), "a".repeat(73))?.message).toMatch(
      /at most 72 bytes/,
    );
    // 37 two-byte letters: 37 characters but 74 bytes.
    const turkish = "ş".repeat(37);
    expect(newPasswordProblem(turkish, turkish)?.message).toMatch(/too long/);
  });

  it("flags a mismatched confirmation on the confirmation field", () => {
    expect(newPasswordProblem("abcdefgh", "abcdefgX")).toEqual({
      field: "confirmation",
      message: "Passwords don't match.",
    });
  });
});
