import { afterEach, describe, expect, it, vi } from "vitest";

import { decodeJwtClaims, isExpired } from "./jwt";

/** Build a JWT-shaped string (`header.payload.signature`) whose payload is the
 * base64url encoding of `claims`. Only the payload segment is ever read, so the
 * header/signature are inert placeholders. */
function makeJwt(claims: Record<string, unknown>): string {
  // UTF-8 encode first (like a real JWT) so non-ASCII claims round-trip; plain
  // btoa(str) can't encode code points > 255.
  const bytes = new TextEncoder().encode(JSON.stringify(claims));
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${b64}.sig`;
}

describe("decodeJwtClaims", () => {
  it("pulls username/email/role/exp from a well-formed token", () => {
    const jwt = makeJwt({
      username: "ada",
      email: "ada@example.com",
      role: "admin",
      exp: 1893456000,
    });
    expect(decodeJwtClaims(jwt)).toEqual({
      username: "ada",
      email: "ada@example.com",
      role: "admin",
      exp: 1893456000,
      tenantId: "",
      activeTenantId: "",
      orgRole: "",
      isPlatformAdmin: false,
    });
  });

  it("decodes multi-tenant org claims when present", () => {
    const jwt = makeJwt({
      username: "ada",
      tenant_id: "17",
      active_tenant_id: "20",
      org_role: "admin",
      is_platform_admin: true,
    });
    const claims = decodeJwtClaims(jwt);
    expect(claims.tenantId).toBe("17");
    expect(claims.activeTenantId).toBe("20");
    expect(claims.orgRole).toBe("admin");
    expect(claims.isPlatformAdmin).toBe(true);
  });

  it("decodes base64url payloads (- and _) without choking", () => {
    // A payload whose base64 would contain + and / — proves the url-safe
    // substitution in decode is actually exercised.
    const jwt = makeJwt({ username: "a>b?c", email: "", role: "", exp: 0 });
    expect(decodeJwtClaims(jwt).username).toBe("a>b?c");
  });

  it("decodes non-ASCII (Turkish) usernames/emails without mojibake", () => {
    const jwt = makeJwt({
      username: "İhsan Şşğ",
      email: "öörnek@çay.com",
      role: "üye",
      exp: 0,
    });
    const claims = decodeJwtClaims(jwt);
    expect(claims.username).toBe("İhsan Şşğ");
    expect(claims.email).toBe("öörnek@çay.com");
    expect(claims.role).toBe("üye");
  });

  it("fails open to empty claims on a malformed token", () => {
    expect(decodeJwtClaims("not-a-jwt")).toEqual({
      username: "",
      email: "",
      role: "",
      exp: 0,
      tenantId: "",
      activeTenantId: "",
      orgRole: "",
      isPlatformAdmin: false,
    });
  });

  it("coerces wrong-typed claims to safe defaults", () => {
    const jwt = makeJwt({ username: 42, role: null, exp: "soon" });
    expect(decodeJwtClaims(jwt)).toEqual({
      username: "",
      email: "",
      role: "",
      exp: 0,
      tenantId: "",
      activeTenantId: "",
      orgRole: "",
      isPlatformAdmin: false,
    });
  });
});

describe("isExpired", () => {
  afterEach(() => vi.useRealTimers());

  it("treats exp === 0 (no expiry) as never-expired", () => {
    expect(isExpired(0)).toBe(false);
  });

  it("is true once the exp second has passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:10Z"));
    const tenSecondsAgo = Math.floor(Date.parse("2030-01-01T00:00:00Z") / 1000);
    expect(isExpired(tenSecondsAgo)).toBe(true);
  });

  it("is false while the exp is still in the future", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const inAnHour = Math.floor(Date.parse("2030-01-01T01:00:00Z") / 1000);
    expect(isExpired(inAnHour)).toBe(false);
  });
});
