import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./api";
import { MAX_PASSWORD_BYTES, passwordByteLength } from "./password";
import {
  confirmPasswordReset,
  isInvalidResetTokenError,
  requestPasswordReset,
  takeResetTokenFromUrl,
} from "./passwordReset";

function respond(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("password reset API", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("requests a link with the email only, unauthenticated", async () => {
    vi.mocked(fetch).mockResolvedValue(respond(202, { detail: "accepted" }));
    await requestPasswordReset("a@example.com");
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toMatch(/\/v1\/auth\/password-reset\/request$/);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ email: "a@example.com" });
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("confirms with token and new password, resolving on 204", async () => {
    vi.mocked(fetch).mockResolvedValue(respond(204));
    await expect(confirmPasswordReset("tok", "new password")).resolves.toBeUndefined();
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toMatch(/\/v1\/auth\/password-reset\/confirm$/);
    expect(JSON.parse(init?.body as string)).toEqual({
      token: "tok",
      new_password: "new password",
    });
  });

  it("recognises the generic invalid-token error", async () => {
    vi.mocked(fetch).mockResolvedValue(respond(400, { detail: "invalid_or_expired_token" }));
    const err = await confirmPasswordReset("tok", "new password").catch((e) => e);
    expect(isInvalidResetTokenError(err)).toBe(true);
    expect(isInvalidResetTokenError(new ApiError("other", 400))).toBe(false);
    expect(isInvalidResetTokenError(new ApiError("invalid_or_expired_token", 422))).toBe(false);
  });
});

describe("takeResetTokenFromUrl", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("reads the fragment token and removes it from the URL", () => {
    window.history.replaceState(null, "", "/reset-password?x=1#token=abc-DEF_123");
    expect(takeResetTokenFromUrl()).toBe("abc-DEF_123");
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("abc-DEF_123");
    expect(window.location.pathname + window.location.search).toBe("/reset-password?x=1");
  });

  it("returns null without a token, still clearing any fragment", () => {
    window.history.replaceState(null, "", "/reset-password");
    expect(takeResetTokenFromUrl()).toBeNull();
    window.history.replaceState(null, "", "/reset-password#other=1");
    expect(takeResetTokenFromUrl()).toBeNull();
    expect(window.location.hash).toBe("");
  });
});

describe("passwordByteLength", () => {
  it("counts UTF-8 bytes, not characters", () => {
    expect(passwordByteLength("a".repeat(72))).toBe(MAX_PASSWORD_BYTES);
    expect(passwordByteLength("é")).toBe(2);
    expect(passwordByteLength("🔑")).toBe(4);
  });
});
