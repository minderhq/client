import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import type { DirectoryUser, MyOrg, OrgMember } from "../lib/orgs";
import { OrgUsersPage } from "./OrgUsersPage";

const apiFetch = vi.fn();

vi.mock("react-router-dom", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => apiFetch(...args),
  };
});

const confirmMock = vi.fn().mockResolvedValue(true);
vi.mock("../components/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: confirmMock, dialog: null }),
}));

const SIGNED_OUT = {
  isAuthenticated: false,
  token: "",
  sessionKey: "",
  userId: "",
  role: "",
  activeTenantId: "",
  orgRole: "",
  isPlatformAdmin: false,
};
let mockAuth = { ...SIGNED_OUT };
vi.mock("../lib/auth", () => ({
  useAuth: () => mockAuth,
}));

/** Signed in as user 10, acting in org 1. */
function signIn(overrides: Partial<typeof SIGNED_OUT> = {}) {
  mockAuth = {
    ...SIGNED_OUT,
    isAuthenticated: true,
    token: "tok",
    sessionKey: "s1",
    userId: "10",
    role: "user",
    activeTenantId: "1",
    orgRole: "member",
    ...overrides,
  };
}

function org(overrides: Partial<MyOrg> = {}): MyOrg {
  return { id: 1, name: "Acme Corporation", slug: "acme", org_role: "member", is_home: true, ...overrides };
}

function member(overrides: Partial<OrgMember> = {}): OrgMember {
  return {
    user_id: 2,
    username: "bob",
    email: "bob@example.com",
    org_role: "member",
    is_home: true,
    is_active: true,
    suspended_at: null,
    is_oidc_linked: false,
    must_change_password: false,
    managed_by_caller: false,
    resettable_by_caller: false,
    ...overrides,
  };
}

const MANAGER = ["org.members.view", "org.members.manage", "org.members.suspend"];

/** Routes apiFetch by method+path. `perms` is the caller's effective
 * permission keys (or an Error to make that lookup fail). `fail` maps
 * "METHOD path" to an error that request should reject with. */
function routeApiFetch(opts: {
  members?: OrgMember[];
  perms?: string[] | Error;
  users?: DirectoryUser[];
  membersError?: Error;
  fail?: Record<string, Error>;
} = {}) {
  const { members = [member()], perms = ["org.members.view"], users = [], fail = {} } = opts;
  apiFetch.mockImplementation((path: string, init?: { method?: string; body?: unknown }) => {
    const method = init?.method ?? "GET";
    const failure = fail[`${method} ${path}`];
    if (failure) return Promise.reject(failure);
    if (path === "/v1/organizations/mine")
      return Promise.resolve({ organizations: [org()], active_organization_id: 1 });
    if (path === "/v1/organizations/1/members/10/effective-permissions") {
      if (perms instanceof Error) return Promise.reject(perms);
      return Promise.resolve({
        organization_id: 1,
        user_id: 10,
        permissions: perms.map((k) => ({ permission_key: k, role_id: 1 })),
      });
    }
    if (path === "/v1/organizations/1/members" && method === "GET") {
      if (opts.membersError) return Promise.reject(opts.membersError);
      return Promise.resolve({ members });
    }
    if (path === "/v1/auth/users" && method === "GET") return Promise.resolve({ users });
    if (path.startsWith("/v1/organizations/1/members")) {
      if (path.endsWith("/reset-password"))
        return Promise.resolve({
          organization_id: 1,
          user_id: 2,
          mode: "generate",
          must_change_password: true,
          temporary_password: "Temp-Pass-123",
        });
      return Promise.resolve({});
    }
    return Promise.reject(new Error(`unexpected ${method} ${path}`));
  });
}

/** The list item for one member, by username. */
async function row(username: string) {
  const name = await screen.findByText(username);
  return name.closest("li") as HTMLElement;
}

function calledPaths(): string[] {
  return apiFetch.mock.calls.map((c) => c[0] as string);
}

describe("OrgUsersPage", () => {
  afterEach(() => {
    cleanup();
    apiFetch.mockReset();
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
    mockAuth = { ...SIGNED_OUT };
  });

  it("shows a login prompt and never fetches when logged out", () => {
    render(<OrgUsersPage />);
    expect(screen.getByText("Log in to view your organization's users.")).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("lists the active org's members read-only for a caller who may only view", async () => {
    signIn();
    routeApiFetch({ members: [member({ org_role: "admin" })] });
    render(<OrgUsersPage />);

    const bob = await row("bob");
    expect(screen.getByText("Members of Acme Corporation")).toBeTruthy();
    expect(within(bob).getByText("admin")).toBeTruthy(); // read-only role badge
    expect(within(bob).queryByRole("button")).toBeNull();
    expect(within(bob).queryByLabelText(/Role for/)).toBeNull();
    expect(screen.queryByText("Add a member")).toBeNull();
    // Permissions come from the caller's own resolved permissions in the org.
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/organizations/1/members/10/effective-permissions",
      expect.objectContaining({ token: "tok" }),
    );
    expect(calledPaths()).not.toContain("/v1/auth/users");
  });

  it("offers Suspend, but not role change or Remove, with only org.members.suspend", async () => {
    signIn();
    routeApiFetch({ perms: ["org.members.view", "org.members.suspend"] });
    render(<OrgUsersPage />);

    const bob = await row("bob");
    await within(bob).findByRole("button", { name: "Suspend" });
    expect(within(bob).queryByRole("button", { name: /Remove/ })).toBeNull();
    expect(within(bob).queryByLabelText("Role for bob")).toBeNull();
  });

  it("shows reset and deactivate only on accounts the API marks as the caller's to manage", async () => {
    signIn({ orgRole: "admin" });
    routeApiFetch({
      perms: MANAGER,
      members: [
        member({ user_id: 2, username: "bob", managed_by_caller: true, resettable_by_caller: true }),
        member({ user_id: 3, username: "carol", is_oidc_linked: null }),
        member({ user_id: 4, username: "dave", org_role: "owner", managed_by_caller: true }),
      ],
    });
    render(<OrgUsersPage />);

    const bob = await row("bob");
    await within(bob).findByRole("button", { name: /Remove/ });
    expect(within(bob).getByRole("button", { name: "Reset password" })).toBeTruthy();
    expect(within(bob).getByRole("button", { name: "Deactivate" })).toBeTruthy();
    expect(within(bob).getByRole("button", { name: "Suspend" })).toBeTruthy();

    // Not managed (e.g. also belongs to another org): org-level actions only.
    const carol = await row("carol");
    expect(within(carol).getByRole("button", { name: "Suspend" })).toBeTruthy();
    expect(within(carol).getByRole("button", { name: /Remove/ })).toBeTruthy();
    expect(within(carol).queryByRole("button", { name: "Reset password" })).toBeNull();
    expect(within(carol).queryByRole("button", { name: "Deactivate" })).toBeNull();

    // Managed but not resettable (an owner): deactivate yes, reset no.
    const dave = await row("dave");
    expect(within(dave).getByRole("button", { name: "Deactivate" })).toBeTruthy();
    expect(within(dave).queryByRole("button", { name: "Reset password" })).toBeNull();
  });

  it("points a non-resettable account to email self-service reset instead", async () => {
    signIn({ orgRole: "admin" });
    routeApiFetch({
      perms: MANAGER,
      members: [
        member({ user_id: 3, username: "carol", is_oidc_linked: null }),
        member({ user_id: 5, username: "erin", managed_by_caller: true, is_oidc_linked: true }),
        member({ user_id: 2, username: "bob", managed_by_caller: true, resettable_by_caller: true }),
      ],
    });
    render(<OrgUsersPage />);

    const carol = await row("carol");
    const hint = await within(carol).findByRole("link", { name: "carol can reset it by email" });
    expect(hint.getAttribute("href")).toBe("/forgot-password");
    expect(within(await row("erin")).getByText("Password is managed by single sign-on.")).toBeTruthy();
    expect(within(await row("bob")).queryByText(/can reset it by email/)).toBeNull();
  });

  it("doesn't show the self-service hint to a caller who can't manage members", async () => {
    signIn();
    routeApiFetch({ members: [member({ username: "carol" })] });
    render(<OrgUsersPage />);

    const carol = await row("carol");
    expect(within(carol).queryByText(/can reset it by email/)).toBeNull();
  });

  it("offers no suspend, reset or deactivate on the caller's own row", async () => {
    signIn({ orgRole: "owner" });
    routeApiFetch({
      perms: MANAGER,
      members: [member({ user_id: 10, username: "me", managed_by_caller: true, resettable_by_caller: true })],
    });
    render(<OrgUsersPage />);

    const me = await row("me");
    await within(me).findByLabelText("Role for me");
    expect(within(me).queryByRole("button", { name: "Suspend" })).toBeNull();
    expect(within(me).queryByRole("button", { name: "Reset password" })).toBeNull();
    expect(within(me).queryByRole("button", { name: "Deactivate" })).toBeNull();
    expect(within(me).queryByText(/can reset it by email/)).toBeNull();
  });

  it("suspends after confirming, through the org-scoped route", async () => {
    signIn({ orgRole: "admin" });
    routeApiFetch({ perms: MANAGER });
    render(<OrgUsersPage />);

    fireEvent.click(await within(await row("bob")).findByRole("button", { name: "Suspend" }));

    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Suspend bob?", danger: true }),
    );
    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/organizations/1/members/2/suspend", {
        method: "POST",
        token: "tok",
      }),
    );
    await screen.findByText("Member suspended.");
  });

  it("restores a suspended member without a confirm", async () => {
    signIn({ orgRole: "admin" });
    routeApiFetch({ perms: MANAGER, members: [member({ suspended_at: "2026-10-01T00:00:00Z" })] });
    render(<OrgUsersPage />);

    const bob = await row("bob");
    expect(within(bob).getByText("suspended")).toBeTruthy();
    fireEvent.click(await within(bob).findByRole("button", { name: "Unsuspend" }));

    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/organizations/1/members/2/unsuspend", {
        method: "POST",
        token: "tok",
      }),
    );
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("deactivates a managed account through the org account-status route", async () => {
    signIn({ orgRole: "admin" });
    routeApiFetch({ perms: MANAGER, members: [member({ managed_by_caller: true })] });
    render(<OrgUsersPage />);

    fireEvent.click(await within(await row("bob")).findByRole("button", { name: "Deactivate" }));

    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/organizations/1/members/2/account-status", {
        method: "PATCH",
        body: { is_active: false },
        token: "tok",
      }),
    );
    await screen.findByText("Account deactivated.");
    expect(calledPaths().some((p) => p.startsWith("/v1/auth/users/"))).toBe(false);
  });

  it("reactivates a deactivated managed account without a confirm", async () => {
    signIn({ orgRole: "admin" });
    routeApiFetch({ perms: MANAGER, members: [member({ managed_by_caller: true, is_active: false })] });
    render(<OrgUsersPage />);

    const bob = await row("bob");
    expect(within(bob).getByText("deactivated")).toBeTruthy();
    fireEvent.click(await within(bob).findByRole("button", { name: "Reactivate" }));

    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/organizations/1/members/2/account-status", {
        method: "PATCH",
        body: { is_active: true },
        token: "tok",
      }),
    );
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("resets a resettable account's password through the org-scoped route", async () => {
    signIn({ orgRole: "admin" });
    routeApiFetch({
      perms: MANAGER,
      members: [member({ managed_by_caller: true, resettable_by_caller: true })],
    });
    render(<OrgUsersPage />);

    fireEvent.click(await within(await row("bob")).findByRole("button", { name: "Reset password" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset password" }));

    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/organizations/1/members/2/reset-password", {
        method: "POST",
        token: "tok",
        body: { mode: "generate" },
      }),
    );
    expect(((await screen.findByLabelText("Temporary password")) as HTMLInputElement).value).toBe(
      "Temp-Pass-123",
    );
    expect(calledPaths().some((p) => p.startsWith("/v1/auth/users"))).toBe(false);
  });

  it("removes a member and changes a role through the org member routes", async () => {
    signIn({ orgRole: "admin" });
    routeApiFetch({ perms: MANAGER });
    render(<OrgUsersPage />);

    const bob = await row("bob");
    fireEvent.change(await within(bob).findByLabelText("Role for bob"), { target: { value: "admin" } });
    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/organizations/1/members", {
        method: "POST",
        body: { user_id: 2, org_role: "admin" },
        token: "tok",
      }),
    );
    await screen.findByText("Role updated.");

    fireEvent.click(within(bob).getByRole("button", { name: /Remove/ }));
    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Remove member?", danger: true }),
    );
    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/organizations/1/members/2", {
        method: "DELETE",
        token: "tok",
      }),
    );
    await screen.findByText("Member removed.");
  });

  it("explains a 404 from an action without naming anything beyond this org", async () => {
    signIn({ orgRole: "admin" });
    routeApiFetch({
      perms: MANAGER,
      fail: {
        "POST /v1/organizations/1/members/2/suspend": new ApiError("Organization or user not found", 404),
      },
    });
    render(<OrgUsersPage />);

    fireEvent.click(await within(await row("bob")).findByRole("button", { name: "Suspend" }));
    await screen.findByText(/isn't in this organization any more, or can't be managed from here/);
  });

  it("explains a 403 during the caller's own forced password change, and stays signed in", async () => {
    signIn({ orgRole: "admin" });
    routeApiFetch({
      perms: MANAGER,
      fail: {
        "DELETE /v1/organizations/1/members/2": new ApiError("password_change_required", 403),
      },
    });
    render(<OrgUsersPage />);

    fireEvent.click(await within(await row("bob")).findByRole("button", { name: /Remove/ }));
    await screen.findByText(/Change your own password first/);
    // Still on the page with the list intact (a 403 never logs out).
    expect(screen.getByText("bob")).toBeTruthy();
  });

  it("shows a permission message when the member list itself is forbidden", async () => {
    signIn();
    routeApiFetch({ membersError: new ApiError("Requires org.members.view on this organization", 403) });
    render(<OrgUsersPage />);

    await screen.findByText("You don't have permission to see this organization's members.");
  });

  it("falls back to the org role when the permission lookup fails", async () => {
    signIn({ orgRole: "owner" });
    routeApiFetch({ perms: new ApiError("Not found", 404) });
    render(<OrgUsersPage />);

    const bob = await row("bob");
    await within(bob).findByRole("button", { name: /Remove/ });
    expect(within(bob).getByRole("button", { name: "Suspend" })).toBeTruthy();
  });

  describe("Platform Admin", () => {
    it("can add an existing account from the directory; others can't and never fetch it", async () => {
      signIn({ isPlatformAdmin: true, orgRole: "" });
      routeApiFetch({
        perms: [],
        members: [member()],
        users: [
          { id: 2, username: "bob", email: "bob@example.com" },
          { id: 7, username: "gina", email: "gina@example.com" },
        ],
      });
      render(<OrgUsersPage />);
      await row("bob");

      expect(screen.getByRole("link", { name: /All users \(Platform Admin\)/ }).getAttribute("href")).toBe(
        "/platform/users",
      );
      const picker = (await screen.findByLabelText("Add a member")) as HTMLSelectElement;
      await screen.findByText("gina (gina@example.com)");
      expect(screen.queryByText("bob (bob@example.com)")).toBeNull(); // already a member
      fireEvent.change(picker, { target: { value: "7" } });
      fireEvent.click(screen.getByRole("button", { name: "Add" }));

      await vi.waitFor(() =>
        expect(apiFetch).toHaveBeenCalledWith("/v1/organizations/1/members", {
          method: "POST",
          body: { user_id: 7, org_role: "member" },
          token: "tok",
        }),
      );
      await screen.findByText("Member added.");
    });

    it("gets org-level actions in any org, account actions still only per the flags", async () => {
      signIn({ isPlatformAdmin: true, orgRole: "" });
      routeApiFetch({ perms: [], members: [member()] });
      render(<OrgUsersPage />);

      const bob = await row("bob");
      expect(within(bob).getByRole("button", { name: "Suspend" })).toBeTruthy();
      expect(within(bob).getByRole("button", { name: /Remove/ })).toBeTruthy();
      expect(within(bob).queryByRole("button", { name: "Reset password" })).toBeNull();
      expect(within(bob).queryByRole("button", { name: "Deactivate" })).toBeNull();
    });
  });
});
