import { afterEach, describe, expect, it } from "vitest";

import {
  PENDING_SSO_KEY,
  PENDING_SSO_TTL_MS,
  beginSsoLogin,
  completeSsoLogin,
  generateSsoNonce,
} from "./ssoLogin";

function nonceOf(url: string): string {
  return new URL(url).searchParams.get("cnonce") ?? "";
}

describe("ssoLogin", () => {
  afterEach(() => sessionStorage.clear());

  it("generates distinct base64url nonces of at least 128 bits", () => {
    const a = generateSsoNonce();
    const b = generateSsoNonce();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("appends the nonce to the login URL, keeping existing query params", () => {
    const url = beginSsoLogin("https://api.example.com/v1/auth/oidc/login?x=1");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("x")).toBe("1");
    expect(parsed.searchParams.get("cnonce")).toBe(
      JSON.parse(sessionStorage.getItem(PENDING_SSO_KEY) ?? "{}").nonce,
    );
  });

  it("accepts the matching nonce once", () => {
    const nonce = nonceOf(beginSsoLogin("https://api.example.com/login"));
    expect(completeSsoLogin(nonce)).toBe(true);
    expect(completeSsoLogin(nonce)).toBe(false);
  });

  it("rejects when no login is pending", () => {
    expect(completeSsoLogin("QUJDREVGR0hJSktMTU5PUFFSU1RVVg")).toBe(false);
  });

  it("rejects a mismatched or missing nonce, and clears the pending login", () => {
    const nonce = nonceOf(beginSsoLogin("https://api.example.com/login"));
    expect(completeSsoLogin(nonce.slice(0, -1) + (nonce.endsWith("A") ? "B" : "A"))).toBe(
      false,
    );
    expect(sessionStorage.getItem(PENDING_SSO_KEY)).toBeNull();
    beginSsoLogin("https://api.example.com/login");
    expect(completeSsoLogin(null)).toBe(false);
    expect(sessionStorage.getItem(PENDING_SSO_KEY)).toBeNull();
  });

  it("rejects an expired pending login", () => {
    const start = 1_000_000;
    const nonce = nonceOf(beginSsoLogin("https://api.example.com/login", start));
    expect(completeSsoLogin(nonce, start + PENDING_SSO_TTL_MS + 1)).toBe(false);
  });

  it("treats a malformed pending entry as no pending login", () => {
    sessionStorage.setItem(PENDING_SSO_KEY, "not json");
    expect(completeSsoLogin("anything")).toBe(false);
    expect(sessionStorage.getItem(PENDING_SSO_KEY)).toBeNull();
  });
});
