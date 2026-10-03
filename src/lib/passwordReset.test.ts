import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TOKEN_KEY } from "./api";
import {
  confirmPasswordReset,
  fetchAuthCapabilities,
  requestPasswordReset,
  useAuthCapabilities,
} from "./passwordReset";

function respond(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers({ "content-type": "application/json" }),
  } as Response;
}

const ACCEPTED = {
  detail: "If an account exists for that address, we've sent instructions.",
};

function lastRequest(): { url: string; init: RequestInit } {
  const [url, init] = vi.mocked(fetch).mock.calls.at(-1)!;
  return { url: String(url), init: init ?? {} };
}

describe("password reset API", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  describe("requestPasswordReset", () => {
    it("POSTs the trimmed address and resolves to accepted on 202", async () => {
      vi.mocked(fetch).mockResolvedValue(respond(202, ACCEPTED));
      await expect(requestPasswordReset("  a@example.com ")).resolves.toBe("accepted");
      const { url, init } = lastRequest();
      expect(url).toMatch(/\/v1\/auth\/password-reset\/request$/);
      expect(init.method).toBe("POST");
      expect(JSON.parse(String(init.body))).toEqual({ email: "a@example.com" });
    });

    it("never sends this tab's session token", async () => {
      sessionStorage.setItem(TOKEN_KEY, "signed-in-token");
      vi.mocked(fetch).mockResolvedValue(respond(202, ACCEPTED));
      await requestPasswordReset("a@example.com");
      const headers = lastRequest().init.headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
    });

    it.each([
      [422, "invalid_email"],
      [429, "rate_limited"],
      [404, "unavailable"],
    ])("maps %i to %s", async (status, outcome) => {
      vi.mocked(fetch).mockResolvedValue(respond(status, { detail: "x" }));
      await expect(requestPasswordReset("a@example.com")).resolves.toBe(outcome);
    });

    it("rejects on a server error or a network failure", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(respond(500, { detail: "boom" }));
      await expect(requestPasswordReset("a@example.com")).rejects.toThrow("boom");
      vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await expect(requestPasswordReset("a@example.com")).rejects.toThrow(TypeError);
    });
  });

  describe("confirmPasswordReset", () => {
    it("POSTs the token and new password and resolves to reset on 204", async () => {
      sessionStorage.setItem(TOKEN_KEY, "signed-in-token");
      vi.mocked(fetch).mockResolvedValue(respond(204));
      await expect(confirmPasswordReset("mpr_tok", "new password")).resolves.toBe("reset");
      const { url, init } = lastRequest();
      expect(url).toMatch(/\/v1\/auth\/password-reset\/confirm$/);
      expect(init.method).toBe("POST");
      expect(JSON.parse(String(init.body))).toEqual({
        token: "mpr_tok",
        new_password: "new password",
      });
      expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    });

    it.each([
      [400, "invalid_token"],
      [422, "rejected_password"],
      [429, "rate_limited"],
      [404, "unavailable"],
    ])("maps %i to %s", async (status, outcome) => {
      vi.mocked(fetch).mockResolvedValue(
        respond(status, { detail: "invalid_or_expired_token" }),
      );
      await expect(confirmPasswordReset("mpr_tok", "new password")).resolves.toBe(outcome);
    });

    it("rejects on a server error", async () => {
      vi.mocked(fetch).mockResolvedValue(respond(503, { detail: "unavailable" }));
      await expect(confirmPasswordReset("mpr_tok", "new password")).rejects.toThrow();
    });
  });

  describe("capabilities", () => {
    const caps = {
      password_reset_email: true,
      email_verification: false,
      registration_mode: "invite",
    };

    it("GETs /v1/auth/capabilities without a bearer token", async () => {
      sessionStorage.setItem(TOKEN_KEY, "signed-in-token");
      vi.mocked(fetch).mockResolvedValue(respond(200, caps));
      await expect(fetchAuthCapabilities()).resolves.toEqual(caps);
      const { url, init } = lastRequest();
      expect(url).toMatch(/\/v1\/auth\/capabilities$/);
      expect(init.method).toBe("GET");
      expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    });

    it("reports email reset when the gateway does", async () => {
      vi.mocked(fetch).mockResolvedValue(respond(200, caps));
      const { result } = renderHook(() => useAuthCapabilities());
      await waitFor(() => expect(result.current.passwordResetEmail).toBe(true));
      expect(result.current.capabilities?.registration_mode).toBe("invite");
    });

    it("reports no email reset when the gateway says so", async () => {
      vi.mocked(fetch).mockResolvedValue(
        respond(200, { ...caps, password_reset_email: false }),
      );
      const { result } = renderHook(() => useAuthCapabilities());
      await waitFor(() => expect(result.current.capabilities).not.toBeNull());
      expect(result.current.passwordResetEmail).toBe(false);
    });

    it.each([
      ["an older gateway without the route (404)", () => respond(404, { detail: "Not Found" })],
      ["a server error", () => respond(500, {})],
      ["an unexpected body", () => respond(200, { password_reset_email: "yes" })],
    ])("degrades to no email reset on %s", async (_name, response) => {
      vi.mocked(fetch).mockResolvedValue(response());
      const { result } = renderHook(() => useAuthCapabilities());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.passwordResetEmail).toBe(false);
    });

    it("degrades to no email reset on a network failure", async () => {
      vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
      const { result } = renderHook(() => useAuthCapabilities());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.passwordResetEmail).toBe(false);
      expect(result.current.capabilities).toBeNull();
    });
  });
});
