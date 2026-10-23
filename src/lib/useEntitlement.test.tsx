import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./api";
import { useEntitlement } from "./useEntitlement";

const apiFetch = vi.fn();
vi.mock("./api", async () => ({
  ...(await vi.importActual<typeof import("./api")>("./api")),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

let mode = "saas";
vi.mock("./billing", async () => ({
  ...(await vi.importActual<typeof import("./billing")>("./billing")),
  get deploymentMode() {
    return mode;
  },
}));

let mockAuth = { isAuthenticated: true, token: "t", sessionKey: "u1:1", activeTenantId: "1", tenantId: "1", isPlatformAdmin: false };
vi.mock("./auth", () => ({ useAuth: () => mockAuth }));

function limits(orgId: number, tier: string, extra: object = {}) {
  return {
    organization_id: orgId,
    view: "member",
    tier,
    enforced: true,
    limits: [
      { key: "policy.domain_auto_join", kind: "knob", value: true },
      { key: "policy.sso_required", kind: "knob", value: false },
    ],
    ...extra,
  };
}

function route(byOrg: Record<number, object>, sub: object | Error = { tier: "pro", can_manage: true }) {
  apiFetch.mockImplementation((path: string) => {
    const m = /^\/v1\/organizations\/(\d+)\/limits$/.exec(path);
    if (m) return Promise.resolve(byOrg[Number(m[1])]);
    if (path === "/v1/billing/subscription") return sub instanceof Error ? Promise.reject(sub) : Promise.resolve(sub);
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

describe("useEntitlement", () => {
  beforeEach(() => {
    mode = "saas";
    mockAuth = { isAuthenticated: true, token: "t", sessionKey: "u1:1", activeTenantId: "1", tenantId: "1", isPlatformAdmin: false };
  });
  afterEach(() => {
    cleanup();
    apiFetch.mockReset();
  });

  it("returns the org's tier and which features are on, through the shared read cache", async () => {
    route({ 1: limits(1, "pro") });
    const { result } = renderHook(() => useEntitlement());
    await waitFor(() => expect(result.current.tier).toBe("pro"));
    expect(result.current.isAvailable("policy.domain_auto_join")).toBe(true);
    expect(result.current.isAvailable("policy.sso_required")).toBe(false);
    expect(result.current.isAvailable("no.such.feature")).toBe(false);
    expect(result.current.seats).toBeNull();
    expect(apiFetch).toHaveBeenCalledWith("/v1/organizations/1/limits", expect.objectContaining({ cache: true }));
  });

  it("refetches for the new org on an org switch, never showing the old org's numbers", async () => {
    route({ 1: limits(1, "community"), 2: limits(2, "enterprise") });
    const { result, rerender } = renderHook(() => useEntitlement());
    await waitFor(() => expect(result.current.tier).toBe("community"));

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation(async (...args: unknown[]) => {
      await gate;
      return base(...(args as [string]));
    });
    mockAuth = { ...mockAuth, sessionKey: "u1:2", activeTenantId: "2", tenantId: "2" };
    rerender();
    expect(result.current.tier).toBeNull();
    release();
    await waitFor(() => expect(result.current.tier).toBe("enterprise"));
    expect(apiFetch).toHaveBeenCalledWith("/v1/organizations/2/limits", expect.anything());
  });

  it("on SaaS a billing owner is whoever the subscription says can manage it", async () => {
    route({ 1: limits(1, "free") }, { tier: "free", can_manage: true });
    const owner = renderHook(() => useEntitlement());
    await waitFor(() => expect(owner.result.current.canManageBilling).toBe(true));
    cleanup();

    route({ 1: limits(1, "free") }, new ApiError("forbidden", 403));
    const admin = renderHook(() => useEntitlement());
    await waitFor(() => expect(admin.result.current.tier).toBe("free"));
    expect(admin.result.current.canManageBilling).toBe(false);
  });

  it("on a self-hosted install only a Platform Admin holds the licence, and billing isn't asked", async () => {
    mode = "self-hosted";
    route({ 1: limits(1, "community") });
    const admin = renderHook(() => useEntitlement());
    await waitFor(() => expect(admin.result.current.tier).toBe("community"));
    expect(admin.result.current.canManageBilling).toBe(false);
    expect(admin.result.current.deployment).toBe("self-hosted");
    cleanup();

    mockAuth = { ...mockAuth, isPlatformAdmin: true };
    const operator = renderHook(() => useEntitlement());
    await waitFor(() => expect(operator.result.current.canManageBilling).toBe(true));
    expect(apiFetch.mock.calls.map((c) => c[0])).not.toContain("/v1/billing/subscription");
  });
});
