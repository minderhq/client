import { cleanup, render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RequirePermission } from "../components/RequirePermission";
import { useAccess, useAllows, useCan, useEffectivePermissions } from "./useCan";

let mockAuth: Record<string, unknown> = {};
vi.mock("./auth", () => ({ useAuth: () => mockAuth }));
let mockBilling = false;
vi.mock("./useBillingAccess", () => ({ useBillingAccess: () => mockBilling }));

const MEMBER = {
  isAuthenticated: true,
  role: "user",
  orgRole: "member",
  isPlatformAdmin: false,
  activeTenantId: "1",
  tenantId: "1",
};

describe("useCan (#131)", () => {
  beforeEach(() => {
    mockAuth = { ...MEMBER };
    mockBilling = false;
  });
  afterEach(cleanup);

  it("reads the session from useAuth", () => {
    expect(renderHook(() => useAllows("member")).result.current).toBe(true);
    expect(renderHook(() => useCan("org.members.manage")).result.current).toBe(false);
    mockAuth = { ...MEMBER, orgRole: "admin" };
    expect(renderHook(() => useCan("org.members.manage")).result.current).toBe(true);
  });

  it("takes billing from the billing probe", () => {
    expect(renderHook(() => useCan("org.billing.view")).result.current).toBe(false);
    mockBilling = true;
    expect(renderHook(() => useCan("org.billing.view")).result.current).toBe(true);
  });

  it("scopes to the active org, falling back to the home org", () => {
    mockAuth = { ...MEMBER, orgRole: "owner", activeTenantId: "", tenantId: "7" };
    expect(renderHook(() => useCan("org.settings.manage", { orgId: "7" })).result.current).toBe(true);
    expect(renderHook(() => useCan("org.settings.manage", { orgId: "8" })).result.current).toBe(false);
  });

  it("allows nothing signed out", () => {
    mockAuth = { isAuthenticated: false, role: "", orgRole: "" };
    mockBilling = true;
    expect(renderHook(() => useEffectivePermissions()).result.current).toBeNull();
    const access = renderHook(() => useAccess()).result.current;
    expect(access.isMember).toBe(false);
    expect(access.can("org.billing.view")).toBe(false);
  });

  it("gates operator screens on the Platform Admin, not a key", () => {
    expect(renderHook(() => useAllows("platform-admin")).result.current).toBe(false);
    mockAuth = { ...MEMBER, isPlatformAdmin: true };
    expect(renderHook(() => useAllows("platform-admin")).result.current).toBe(true);
  });

  it("keeps the same gates between renders while the session is unchanged", () => {
    const { result, rerender } = renderHook(() => useAccess());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

describe("RequirePermission (#131)", () => {
  beforeEach(() => {
    mockAuth = { ...MEMBER };
    mockBilling = false;
  });
  afterEach(cleanup);

  function guard() {
    render(
      <MemoryRouter>
        <RequirePermission requires="org.members.manage">
          <h1>Members</h1>
        </RequirePermission>
      </MemoryRouter>,
    );
  }

  it("renders the page for a caller who holds the permission", () => {
    mockAuth = { ...MEMBER, orgRole: "owner" };
    guard();
    expect(screen.getByRole("heading", { name: "Members" })).toBeTruthy();
  });

  it("renders the forbidden page, naming who it is for, for one who doesn't", () => {
    guard();
    expect(screen.queryByRole("heading", { name: "Members" })).toBeNull();
    expect(screen.getByRole("heading", { name: "You don't have access to this page" })).toBeTruthy();
    expect(screen.getByText("This page is open to organization owners and admins.")).toBeTruthy();
    const request = screen.getByRole("button", { name: "Request access" }) as HTMLButtonElement;
    expect(request.disabled).toBe(true);
    expect(request.getAttribute("aria-describedby")).toBe("request-access-soon");
    expect(screen.getByRole("link", { name: "Back to home" }).getAttribute("href")).toBe("/");
  });

  it("asks a signed-out visitor to sign in", () => {
    mockAuth = { isAuthenticated: false, role: "", orgRole: "" };
    guard();
    expect(screen.getByRole("heading", { name: "Sign in to continue" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Log in" }).getAttribute("href")).toBe("/login");
    expect(screen.queryByRole("button", { name: "Request access" })).toBeNull();
  });
});
