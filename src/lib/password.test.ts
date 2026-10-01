import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TOKEN_KEY, TOKEN_REFRESHED_EVENT } from "./api";
import { changePassword } from "./password";

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
