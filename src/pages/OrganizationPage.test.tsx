import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DirectoryUser, MyOrg, OrgInvite, OrgMember } from "../lib/orgs";
import { OrganizationPage } from "./OrganizationPage";

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

const copyText = vi.fn();
vi.mock("../lib/browser", () => ({
  copyText: (...args: unknown[]) => copyText(...args),
}));

const confirmMock = vi.fn().mockResolvedValue(true);
vi.mock("../components/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: confirmMock, dialog: null }),
}));

let mockAuth = {
  isAuthenticated: false,
  token: "",
  role: "",
  activeTenantId: "",
  orgRole: "",
};
vi.mock("../lib/auth", () => ({
  useAuth: () => mockAuth,
}));

function org(overrides: Partial<MyOrg> = {}): MyOrg {
  return {
    id: 1,
    name: "Acme Corporation",
    slug: "acme",
    org_role: "member",
    is_home: true,
    ...overrides,
  };
}

function member(overrides: Partial<OrgMember> = {}): OrgMember {
  return {
    user_id: 1,
    username: "alice",
    email: "alice@example.com",
    org_role: "member",
    is_home: true,
    ...overrides,
  } as OrgMember;
}

function invite(overrides: Partial<OrgInvite> = {}): OrgInvite {
  return {
    id: 1,
    email: "new@example.com",
    org_role: "member",
    token: "abc123",
    status: "pending",
    created_at: null,
    expires_at: null,
    max_uses: 1,
    uses: 0,
    ...overrides,
  };
}

function directoryUser(overrides: Partial<DirectoryUser> = {}): DirectoryUser {
  return { id: 2, username: "bob", email: "bob@example.com", ...overrides };
}

/** Routes apiFetch by method+path so each test only needs to say what's
 * different from the defaults (one org, one member, no invites, no
 * directory). */
function routeApiFetch(opts: {
  orgs?: MyOrg[];
  members?: OrgMember[];
  invites?: OrgInvite[];
  users?: DirectoryUser[];
} = {}) {
  const { orgs = [org()], members = [member()], invites = [], users = [] } = opts;
  apiFetch.mockImplementation((path: string, init?: { method?: string; body?: unknown }) => {
    const method = init?.method ?? "GET";
    if (path === "/v1/organizations/mine")
      return Promise.resolve({ organizations: orgs, active_organization_id: orgs[0]?.id ?? null });
    if (/\/v1\/organizations\/\d+\/members$/.test(path) && method === "GET")
      return Promise.resolve({ members, total: members.length });
    if (/\/v1\/organizations\/\d+\/members$/.test(path) && method === "POST")
      return Promise.resolve({});
    if (/\/v1\/organizations\/\d+\/members\/\d+$/.test(path) && method === "DELETE")
      return Promise.resolve({});
    if (/\/v1\/organizations\/\d+\/invites$/.test(path) && method === "GET")
      return Promise.resolve({ invites, total: invites.length });
    if (/\/v1\/organizations\/\d+\/invites$/.test(path) && method === "POST")
      return Promise.resolve(invite());
    if (/\/v1\/organizations\/\d+\/invites\/\d+\/revoke$/.test(path))
      return Promise.resolve({ ...invite(), status: "revoked" });
    if (path === "/v1/auth/users") return Promise.resolve({ users });
    return Promise.reject(new Error(`unexpected ${method} ${path}`));
  });
}

describe("OrganizationPage", () => {
  afterEach(() => {
    apiFetch.mockReset();
    copyText.mockReset();
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
    mockAuth = { isAuthenticated: false, token: "", role: "", activeTenantId: "", orgRole: "" };
    cleanup();
  });

  it("shows a login prompt and never fetches when logged out", () => {
    render(<OrganizationPage />);
    expect(screen.getByText("Log in to view your organization.")).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("shows an empty state when the user belongs to no organization", async () => {
    mockAuth = { isAuthenticated: true, token: "tok", role: "user", activeTenantId: "", orgRole: "" };
    routeApiFetch({ orgs: [] });
    render(<OrganizationPage />);

    await screen.findByText(
      "You don't belong to any organization yet. Organizations are provisioned by an administrator.",
    );
  });

  it("renders the active org, its home badge, and the caller's role", async () => {
    mockAuth = {
      isAuthenticated: true,
      token: "tok",
      role: "user",
      activeTenantId: "1",
      orgRole: "owner",
    };
    routeApiFetch({});
    render(<OrganizationPage />);

    const heading = await screen.findByText("Acme Corporation");
    const orgSection = heading.closest("section") as HTMLElement;
    expect(within(orgSection).getByText("home")).toBeTruthy();
    expect(within(orgSection).getByText("owner")).toBeTruthy();
  });

  it("mentions the org switcher once the user belongs to more than one organization", async () => {
    mockAuth = { isAuthenticated: true, token: "tok", role: "user", activeTenantId: "1", orgRole: "member" };
    routeApiFetch({ orgs: [org(), org({ id: 2, name: "Beta Inc", is_home: false })] });
    render(<OrganizationPage />);

    await screen.findByText("Acme Corporation");
    expect(screen.getByText(/You belong to 2 organizations/)).toBeTruthy();
  });

  it("shows members read-only (no role select or Remove) for a plain member", async () => {
    mockAuth = { isAuthenticated: true, token: "tok", role: "user", activeTenantId: "1", orgRole: "member" };
    routeApiFetch({ members: [member(), member({ user_id: 2, username: "bob", org_role: "admin" })] });
    render(<OrganizationPage />);

    await screen.findByText("alice");
    expect(screen.getByText("bob")).toBeTruthy();
    expect(screen.getByText("admin")).toBeTruthy(); // read-only role badge
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
    expect(screen.queryByLabelText(/Role for/)).toBeNull();
  });

  it("shows an empty state when the active org has no members", async () => {
    mockAuth = { isAuthenticated: true, token: "tok", role: "user", activeTenantId: "1", orgRole: "member" };
    routeApiFetch({ members: [] });
    render(<OrganizationPage />);

    await screen.findByText("No members found.");
  });

  it("gives an org owner management controls over other members, without the admin-only add-member form", async () => {
    mockAuth = { isAuthenticated: true, token: "tok", role: "user", activeTenantId: "1", orgRole: "owner" };
    routeApiFetch({ members: [member(), member({ user_id: 2, username: "bob" })] });
    render(<OrganizationPage />);

    await screen.findByText("alice");
    expect(screen.getByLabelText("Role for alice")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Remove/ }).length).toBe(2);
    // #1208: org owner/admin manage existing members, but adding a brand-new
    // member still needs the instance-admin-only directory.
    expect(screen.queryByText("Add a member")).toBeNull();
  });

  it("lets an instance admin add an existing user, excluding current members from the picker", async () => {
    mockAuth = { isAuthenticated: true, token: "tok", role: "admin", activeTenantId: "1", orgRole: "" };
    routeApiFetch({
      members: [member()],
      users: [directoryUser({ id: 1, username: "alice" }), directoryUser({ id: 2, username: "bob" })],
    });
    render(<OrganizationPage />);
    await screen.findByText("alice");

    const picker = screen.getByLabelText("Add a member") as HTMLSelectElement;
    expect(screen.queryByText("alice (alice@example.com)")).toBeNull(); // already a member
    fireEvent.change(picker, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/v1/organizations/1/members",
        { method: "POST", body: { user_id: 2, org_role: "member" }, token: "tok" },
      ),
    );
    await screen.findByText("Member added.");
  });

  it("changes a member's role", async () => {
    mockAuth = { isAuthenticated: true, token: "tok", role: "admin", activeTenantId: "1", orgRole: "" };
    routeApiFetch({ members: [member({ user_id: 2, username: "bob", org_role: "member" })] });
    render(<OrganizationPage />);
    await screen.findByText("bob");

    fireEvent.change(screen.getByLabelText("Role for bob"), { target: { value: "admin" } });

    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/v1/organizations/1/members",
        { method: "POST", body: { user_id: 2, org_role: "admin" }, token: "tok" },
      ),
    );
    await screen.findByText("Role updated.");
  });

  it("removes a member after confirming", async () => {
    mockAuth = { isAuthenticated: true, token: "tok", role: "admin", activeTenantId: "1", orgRole: "" };
    routeApiFetch({ members: [member({ user_id: 2, username: "bob" })] });
    render(<OrganizationPage />);
    await screen.findByText("bob");

    fireEvent.click(screen.getByRole("button", { name: /Remove/ }));

    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Remove member?", danger: true }),
    );
    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/v1/organizations/1/members/2",
        { method: "DELETE", token: "tok" },
      ),
    );
    await screen.findByText("Member removed.");
  });

  it("does not remove a member when the confirmation is declined", async () => {
    confirmMock.mockResolvedValue(false);
    mockAuth = { isAuthenticated: true, token: "tok", role: "admin", activeTenantId: "1", orgRole: "" };
    routeApiFetch({ members: [member({ user_id: 2, username: "bob" })] });
    render(<OrganizationPage />);
    await screen.findByText("bob");
    apiFetch.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /Remove/ }));

    await vi.waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(apiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/members/2"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("sends an org invite by email and lists it as pending", async () => {
    mockAuth = { isAuthenticated: true, token: "tok", role: "user", activeTenantId: "1", orgRole: "owner" };
    routeApiFetch({});
    render(<OrganizationPage />);
    await screen.findByText("Invite by email");

    fireEvent.change(screen.getByPlaceholderText("person@example.com"), {
      target: { value: "new@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));

    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/v1/organizations/1/invites",
        { method: "POST", body: { email: "new@example.com", org_role: "member" }, token: "tok" },
      ),
    );
    await screen.findByText("Invite sent to new@example.com.");
  });

  it("copies a pending invite's link and can revoke it", async () => {
    mockAuth = { isAuthenticated: true, token: "tok", role: "user", activeTenantId: "1", orgRole: "owner" };
    routeApiFetch({ invites: [invite()] });
    render(<OrganizationPage />);
    await screen.findByText("new@example.com");

    fireEvent.click(screen.getByRole("button", { name: /Copy link/ }));
    expect(copyText).toHaveBeenCalledWith(expect.stringContaining("/invite/abc123"));

    fireEvent.click(screen.getByRole("button", { name: /Revoke/ }));
    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/v1/organizations/1/invites/1/revoke",
        { method: "POST", token: "tok" },
      ),
    );
  });

  it("hides the invite section entirely for a plain member", async () => {
    mockAuth = { isAuthenticated: true, token: "tok", role: "user", activeTenantId: "1", orgRole: "member" };
    routeApiFetch({});
    render(<OrganizationPage />);
    await screen.findByText("Acme Corporation");

    expect(screen.queryByText("Invite by email")).toBeNull();
  });
});
