import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import type { OrgMember } from "../lib/orgs";
import { PersonPage } from "./PersonPage";

const apiFetch = vi.fn();
let routeUserId = "2";

vi.mock("react-router-dom", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  useParams: () => ({ userId: routeUserId }),
}));

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

const confirmMock = vi.fn().mockResolvedValue(true);
vi.mock("../components/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: confirmMock, dialog: null }),
}));

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    token: "tok",
    sessionKey: "s1",
    userId: "10",
    role: "user",
    activeTenantId: "1",
    tenantId: "1",
    orgRole: "admin",
    isPlatformAdmin: false,
  }),
}));

const BOB: OrgMember = {
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
  outside_allowed_domains: false,
};

const ROLES = [
  { id: 1, scope: "organization", name: "member", is_system: true, permissions: ["org.members.view"] },
  { id: 5, scope: "organization", name: "Auditor", is_system: false, permissions: ["org.audit.view"] },
  { id: 6, scope: "organization", name: "Billing", is_system: false, permissions: ["org.billing.view"] },
];

function routeApiFetch(opts: { perms?: string[] } = {}) {
  const perms = opts.perms ?? ["org.members.view", "org.members.manage", "org.members.suspend"];
  apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
    const method = init?.method ?? "GET";
    if (path === "/v1/organizations/mine")
      return Promise.resolve({
        organizations: [{ id: 1, name: "Acme", slug: "acme", org_role: "admin", is_home: true }],
        active_organization_id: 1,
      });
    if (path === "/v1/organizations/1/members/10/effective-permissions")
      return Promise.resolve({ permissions: perms.map((k) => ({ permission_key: k, role_id: 2 })) });
    if (path === "/v1/organizations/1/members" && method === "GET") return Promise.resolve({ members: [BOB] });
    if (path === "/v1/organizations/1/roles") return Promise.resolve({ roles: ROLES });
    if (path === "/v1/organizations/1/members/2/roles" && method === "GET")
      return Promise.resolve({
        assignments: [
          { role_id: 1, role_name: "member", scope: "organization", is_expired: false },
          { role_id: 5, role_name: "Auditor", scope: "organization", expires_at: "2026-11-03T00:00:00Z", is_expired: false },
        ],
      });
    if (path === "/v1/organizations/1/members/2/effective-permissions")
      return Promise.resolve({
        permissions: [
          { permission_key: "org.members.view", role_id: 1, role_name: "member" },
          { permission_key: "org.audit.view", role_id: 5, role_name: "Auditor", permission_group_name: "Read-only" },
          { permission_key: "org.teams.manage", role_id: 9, role_name: "admin", via_ancestor_organization_id: 4 },
        ],
      });
    if (path === "/v1/teams?limit=500") return Promise.resolve({ teams: [{ id: 7 }, { id: 8 }] });
    if (path === "/v1/teams/7")
      return Promise.resolve({ id: 7, name: "Sales", members: [{ user_id: 2, team_role: "team_admin" }] });
    if (path === "/v1/teams/8") return Promise.resolve({ id: 8, name: "Ops", members: [{ user_id: 3, team_role: "member" }] });
    if (path === "/v1/organizations/1/limits") return Promise.reject(new ApiError("forbidden", 403));
    if (path.startsWith("/v1/access-requests") || path.startsWith("/v1/billing"))
      return Promise.resolve({ requests: [], total: 0 });
    if (method !== "GET") return Promise.resolve({});
    return Promise.reject(new Error(`unexpected ${method} ${path}`));
  });
}

function section(name: string): HTMLElement {
  return screen.getByRole("heading", { name }).closest("section")!;
}

describe("PersonPage", () => {
  afterEach(() => {
    cleanup();
    apiFetch.mockReset();
    confirmMock.mockClear();
    routeUserId = "2";
  });

  it("shows their roles, where each permission comes from, and their teams", async () => {
    routeApiFetch();
    render(<PersonPage />);
    expect(await screen.findByRole("heading", { level: 1, name: "bob" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Back to People/ }).getAttribute("href")).toBe("/organization/people");

    const roles = section("Roles");
    expect((within(roles).getByLabelText("Organization role") as HTMLSelectElement).value).toBe("member");
    const auditor = (await within(roles).findByText("Auditor")).closest("li")!;
    expect(auditor.textContent).toMatch(/assigned directly · until/);

    const perms = section("What they can do");
    expect(await within(perms).findByText("See members")).toBeTruthy();
    expect(within(perms).getByText("from Member")).toBeTruthy();
    expect(within(perms).getByText("from Auditor › Read-only")).toBeTruthy();
    expect(within(perms).getByText("from the parent organization (Admin)")).toBeTruthy();

    const teams = section("Teams");
    expect(await within(teams).findByText("Sales")).toBeTruthy();
    expect(within(teams).getByText("team admin")).toBeTruthy();
    expect(within(teams).queryByText("Ops")).toBeNull();
  });

  it("gives an existing custom role until a date, and takes one away", async () => {
    routeApiFetch();
    render(<PersonPage />);
    const roles = (await screen.findByRole("heading", { name: "Roles" })).closest("section")!;
    await within(roles).findByText("Auditor");
    // Only roles they don't hold yet are offered.
    const picker = within(roles).getByLabelText("Give a role") as HTMLSelectElement;
    expect([...picker.options].map((o) => o.textContent)).toEqual(["Choose a role…", "Billing"]);
    fireEvent.change(picker, { target: { value: "6" } });
    fireEvent.change(within(roles).getByLabelText("Until (optional)"), { target: { value: "2026-12-31" } });
    fireEvent.click(within(roles).getByRole("button", { name: "Give role" }));
    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/organizations/1/members/2/roles", {
        method: "POST",
        body: { role_id: 6, expires_at: new Date("2026-12-31T23:59:59").toISOString() },
        token: "tok",
      }),
    );
    expect(await within(roles).findByText("Role given.")).toBeTruthy();

    fireEvent.click(within(roles).getByRole("button", { name: "Take away Auditor" }));
    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/organizations/1/members/2/roles/5", {
        method: "DELETE",
        token: "tok",
      }),
    );
  });

  it("suspends and removes only after a confirmation that lists what they lose", async () => {
    routeApiFetch();
    render(<PersonPage />);
    const access = (await screen.findByRole("heading", { name: "Access" })).closest("section")!;
    await within(section("Teams")).findByText("Sales");
    await within(section("Roles")).findByText("Auditor");

    confirmMock.mockResolvedValueOnce(false);
    fireEvent.click(within(access).getByRole("button", { name: "Suspend" }));
    await vi.waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    const call = confirmMock.mock.calls[0][0];
    expect(call).toMatchObject({ title: "Suspend bob?", danger: true });
    const preview = render(<>{call.details}</>);
    expect(within(preview.container).getByText("Roles they lose here:")).toBeTruthy();
    expect(within(preview.container).getByText("Auditor")).toBeTruthy();
    expect(within(preview.container).getByText("Sales")).toBeTruthy();
    preview.unmount();
    // Cancelled: nothing was sent.
    expect(apiFetch).not.toHaveBeenCalledWith(expect.stringMatching(/\/suspend$/), expect.anything());

    fireEvent.click(within(access).getByRole("button", { name: "Remove" }));
    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/organizations/1/members/2", { method: "DELETE", token: "tok" }),
    );
    expect(confirmMock.mock.lastCall![0]).toMatchObject({ title: "Remove bob?", danger: true });
  });

  it("offers suspend but not remove or role changes with only the suspend permission", async () => {
    routeApiFetch({ perms: ["org.members.view", "org.members.suspend"] });
    render(<PersonPage />);
    const access = (await screen.findByRole("heading", { name: "Access" })).closest("section")!;
    expect(within(access).getByRole("button", { name: "Suspend" })).toBeTruthy();
    expect(within(access).queryByRole("button", { name: "Remove" })).toBeNull();
    expect(within(section("Roles")).queryByRole("combobox")).toBeNull();
  });

  it("says so when the person isn't a member of this organization", async () => {
    routeUserId = "99";
    routeApiFetch();
    render(<PersonPage />);
    expect(await screen.findByRole("heading", { level: 1, name: "Person not found" })).toBeTruthy();
  });
});
