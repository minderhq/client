import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  apiFetch,
  EMAIL_VERIFICATION_REQUIRED_EVENT,
  friendlyErrorMessage,
  isEmailVerificationRequired,
} from "./api";
import {
  confirmEmailVerification,
  DEFAULT_RESEND_COOLDOWN_SECONDS,
  formatWait,
  resendVerificationEmail,
  verifyLinkHours,
} from "./emailVerification";
import { takeTokenFromUrlFragment } from "./passwordReset";

function respond(
  status: number,
  body: unknown = {},
  headers: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(headers),
  } as Response;
}

describe("email verification API (#2447)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("confirmEmailVerification", () => {
    it("posts the token without a bearer and reports the new organization", async () => {
      vi.mocked(fetch).mockResolvedValue(
        respond(200, { detail: "email_verified", organization_id: 12 }),
      );
      expect(await confirmEmailVerification("mev_abc")).toEqual({
        kind: "verified",
        organizationId: 12,
      });
      const [url, init] = vi.mocked(fetch).mock.calls[0];
      expect(String(url)).toMatch(/\/v1\/auth\/verify-email$/);
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(JSON.stringify({ token: "mev_abc" }));
      expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
    });

    it("reads a null organization as null", async () => {
      vi.mocked(fetch).mockResolvedValue(respond(200, { organization_id: null }));
      expect(await confirmEmailVerification("mev_abc")).toEqual({
        kind: "verified",
        organizationId: null,
      });
    });

    it("tells an expired link from any other bad one", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        respond(400, { detail: "invalid_or_expired_token", reason: "expired" }),
      );
      vi.mocked(fetch).mockResolvedValueOnce(
        respond(400, { detail: "invalid_or_expired_token" }),
      );
      expect(await confirmEmailVerification("mev_old")).toEqual({ kind: "expired" });
      expect(await confirmEmailVerification("mev_bad")).toEqual({ kind: "invalid" });
    });

    it("reads Retry-After on a 429, with a default when it isn't readable", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(respond(429, {}, { "Retry-After": "42" }));
      vi.mocked(fetch).mockResolvedValueOnce(respond(429, {}));
      expect(await confirmEmailVerification("t")).toEqual({
        kind: "rate_limited",
        retryAfterSeconds: 42,
      });
      expect(await confirmEmailVerification("t")).toEqual({
        kind: "rate_limited",
        retryAfterSeconds: DEFAULT_RESEND_COOLDOWN_SECONDS,
      });
    });

    it("reports a server without email verification (404) and other failures", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(respond(404, { detail: "Not Found" }));
      vi.mocked(fetch).mockResolvedValueOnce(respond(500, { detail: "boom" }));
      expect(await confirmEmailVerification("t")).toEqual({ kind: "unavailable" });
      expect(await confirmEmailVerification("t")).toEqual({ kind: "error", message: "boom" });
    });
  });

  describe("resendVerificationEmail", () => {
    it("sends with the bearer and returns the cooldown", async () => {
      vi.mocked(fetch).mockResolvedValue(
        respond(202, { detail: "verification_email_sent", retry_after_seconds: 60 }),
      );
      expect(await resendVerificationEmail("jwt")).toEqual({
        kind: "sent",
        retryAfterSeconds: 60,
      });
      const [url, init] = vi.mocked(fetch).mock.calls[0];
      expect(String(url)).toMatch(/\/v1\/auth\/verify-email\/resend$/);
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer jwt");
    });

    it("falls back to the body's retry_after_seconds when Retry-After isn't readable", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        respond(429, { detail: "verification_email_rate_limited", retry_after_seconds: 37 }),
      );
      expect(await resendVerificationEmail("jwt")).toEqual({
        kind: "rate_limited",
        retryAfterSeconds: 37,
      });
    });

    it("maps 429 and every 409 code", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(
          respond(429, { detail: "verification_email_rate_limited" }, { "Retry-After": "86400" }),
        )
        .mockResolvedValueOnce(respond(409, { detail: "email_already_verified" }))
        .mockResolvedValueOnce(respond(409, { detail: "email_undeliverable" }))
        .mockResolvedValueOnce(respond(409, { detail: "email_verification_not_applicable" }));
      expect(await resendVerificationEmail("jwt")).toEqual({
        kind: "rate_limited",
        retryAfterSeconds: 86400,
      });
      expect(await resendVerificationEmail("jwt")).toEqual({ kind: "already_verified" });
      expect(await resendVerificationEmail("jwt")).toEqual({ kind: "undeliverable" });
      expect(await resendVerificationEmail("jwt")).toEqual({ kind: "not_applicable" });
    });
  });

  describe("403 email_verification_required", () => {
    it("is announced with the refused request's bearer, without logging out", async () => {
      sessionStorage.setItem("minder_jwt", "jwt");
      const seen = vi.fn((e: Event) => (e as CustomEvent<unknown>).detail);
      window.addEventListener(EMAIL_VERIFICATION_REQUIRED_EVENT, seen);
      vi.mocked(fetch).mockResolvedValue(
        respond(403, { detail: "email_verification_required" }),
      );
      const err = await apiFetch("/v1/plugins", { token: "jwt" }).catch((e) => e);
      window.removeEventListener(EMAIL_VERIFICATION_REQUIRED_EVENT, seen);
      expect(seen).toHaveBeenCalledTimes(1);
      expect(seen.mock.results[0].value).toBe("jwt");
      expect(isEmailVerificationRequired(err)).toBe(true);
      expect(friendlyErrorMessage(err)).toBe("Confirm your email address to continue.");
      expect(sessionStorage.getItem("minder_jwt")).toBe("jwt");
    });

    it("carries the replayed token after a 401 -> refresh -> replay", async () => {
      const jwt = (sub: string, n: number) =>
        `h.${btoa(JSON.stringify({ sub, n, exp: Math.floor(Date.now() / 1000) + 3600 }))
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "")}.s`;
      const stale = jwt("7", 1);
      const fresh = jwt("7", 2);
      sessionStorage.setItem("minder_jwt", stale);
      const seen = vi.fn((e: Event) => (e as CustomEvent<unknown>).detail);
      window.addEventListener(EMAIL_VERIFICATION_REQUIRED_EVENT, seen);
      vi.mocked(fetch)
        .mockResolvedValueOnce(respond(401, { detail: "expired" }))
        .mockResolvedValueOnce(respond(200, { access_token: fresh }))
        .mockResolvedValueOnce(respond(403, { detail: "email_verification_required" }));
      const err = await apiFetch("/v1/plugins", { token: stale }).catch((e) => e);
      window.removeEventListener(EMAIL_VERIFICATION_REQUIRED_EVENT, seen);
      expect(String(vi.mocked(fetch).mock.calls[1][0])).toMatch(/\/v1\/auth\/refresh$/);
      expect(
        (vi.mocked(fetch).mock.calls[2][1]?.headers as Record<string, string>).Authorization,
      ).toBe(`Bearer ${fresh}`);
      expect(isEmailVerificationRequired(err)).toBe(true);
      expect(seen).toHaveBeenCalledTimes(1);
      expect(seen.mock.results[0].value).toBe(fresh);
    });

    it("is not announced for any other 403", async () => {
      const seen = vi.fn();
      window.addEventListener(EMAIL_VERIFICATION_REQUIRED_EVENT, seen);
      vi.mocked(fetch)
        .mockResolvedValueOnce(respond(403, { detail: "workspace_required" }))
        .mockResolvedValueOnce(respond(403, { detail: "Forbidden" }));
      const a = await apiFetch("/v1/plugins", { token: "jwt" }).catch((e) => e);
      const b = await apiFetch("/v1/plugins", { token: "jwt" }).catch((e) => e);
      window.removeEventListener(EMAIL_VERIFICATION_REQUIRED_EVENT, seen);
      expect(seen).not.toHaveBeenCalled();
      expect(isEmailVerificationRequired(a)).toBe(false);
      expect(isEmailVerificationRequired(b)).toBe(false);
    });
  });
});

describe("email verification helpers", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("takes the token from the fragment and strips it from the URL", () => {
    window.history.replaceState(null, "", "/verify-email?x=1#token=mev_secret");
    expect(takeTokenFromUrlFragment()).toBe("mev_secret");
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("mev_secret");
    expect(window.location.search).toBe("?x=1");
    expect(takeTokenFromUrlFragment()).toBeNull();
  });

  it("formats a wait in the largest whole unit, rounding up", () => {
    expect(formatWait(1)).toBe("1 second");
    expect(formatWait(45)).toBe("45 seconds");
    expect(formatWait(61)).toBe("2 minutes");
    expect(formatWait(3600)).toBe("1 hour");
    expect(formatWait(86400)).toBe("24 hours");
  });

  it("reads the link lifetime only when it is a positive number", () => {
    expect(verifyLinkHours({ email_verify_link_hours: 24 })).toBe(24);
    expect(verifyLinkHours({ email_verify_link_hours: null })).toBeNull();
    expect(verifyLinkHours({ email_verify_link_hours: 0 })).toBeNull();
    expect(verifyLinkHours(null)).toBeNull();
  });
});
