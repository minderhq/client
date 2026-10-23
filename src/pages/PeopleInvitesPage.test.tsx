import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import type { OrgInvite } from "../lib/orgs";
import { PeopleInvitesPage } from "./PeopleInvitesPage";

const apiFetch = vi.fn();

vi.mock("react-router-dom", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

const copyText = vi.fn().mockResolvedValue(true);
vi.mock("../lib/browser", () => ({ copyText: (...args: unknown[]) => copyText(...args) }));

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

function routeApiFetch(opts: { invites?: OrgInvite[] | Error; bulk?: unknown } = {}) {
  apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
    const method = init?.method ?? "GET";
    if (path === "/v1/organizations/mine")
      return Promise.resolve({
        organizations: [{ id: 1, name: "Acme", slug: "acme", org_role: "admin", is_home: true }],
        active_organization_id: 1,
      });
    if (path === "/v1/organizations/1/invites" && method === "GET") {
      const invites = opts.invites ?? [];
      return invites instanceof Error ? Promise.reject(invites) : Promise.resolve({ invites, total: invites.length });
    }
    if (path === "/v1/organizations/1/invites" && method === "POST") return Promise.resolve(invite());
    if (path === "/v1/organizations/1/invites/bulk") return Promise.resolve(opts.bulk);
    if (path === "/v1/organizations/1/invites/1/revoke") return Promise.resolve(invite({ status: "revoked" }));
    // Seat banner and requests count: not this test's concern.
    if (path === "/v1/organizations/1/limits") return Promise.reject(new ApiError("forbidden", 403));
    if (path.startsWith("/v1/access-requests") || path.startsWith("/v1/billing"))
      return Promise.resolve({ requests: [], total: 0 });
    return Promise.reject(new Error(`unexpected ${method} ${path}`));
  });
}

describe("PeopleInvitesPage", () => {
  afterEach(() => {
    cleanup();
    apiFetch.mockReset();
    copyText.mockClear();
    confirmMock.mockClear();
  });

  it("shows the empty state, then a failed list with a retry", async () => {
    routeApiFetch();
    render(<PeopleInvitesPage />);
    expect(await screen.findByText("No invites yet.")).toBeTruthy();
    cleanup();

    routeApiFetch({ invites: new Error("gateway down") });
    render(<PeopleInvitesPage />);
    expect(await screen.findByText("Couldn't load the invites.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Retry/ })).toBeTruthy();
  });

  it("invites one person at the chosen role", async () => {
    routeApiFetch();
    render(<PeopleInvitesPage />);
    const form = (await screen.findByRole("heading", { name: "Invite one person" })).closest("section")!;
    fireEvent.change(within(form).getByLabelText("Email address"), { target: { value: " new@example.com " } });
    fireEvent.change(within(form).getByLabelText("Role"), { target: { value: "admin" } });
    fireEvent.click(within(form).getByRole("button", { name: "Send invite" }));
    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/organizations/1/invites", {
        method: "POST",
        body: { email: "new@example.com", org_role: "admin" },
        token: "tok",
      }),
    );
    expect(await within(form).findByText(/Invite created for new@example.com/)).toBeTruthy();
  });

  it("invites a pasted list in one request and shows each address's result", async () => {
    routeApiFetch({
      bulk: {
        results: [
          { email: "a@x.com", status: "created" },
          { email: "b@x.com", status: "failed", error: "Seat limit reached", reason: "seat_limit" },
          { email: "c@x.com", status: "failed", error: "Invite create failed" },
        ],
        created_count: 1,
        failed_count: 2,
      },
    });
    render(<PeopleInvitesPage />);
    const form = (await screen.findByRole("heading", { name: "Invite a list" })).closest("section")!;
    fireEvent.change(within(form).getByLabelText("Email addresses"), {
      target: { value: "a@x.com, b@x.com\nc@x.com; nope" },
    });
    expect(within(form).getByText(/3 addresses ready\./)).toBeTruthy();
    expect(within(form).getByText(/Not an email address, skipped: nope/)).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "Invite 3 people" }));

    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/organizations/1/invites/bulk", {
        method: "POST",
        body: { emails: ["a@x.com", "b@x.com", "c@x.com"], org_role: "member" },
        token: "tok",
      }),
    );
    const table = await within(form).findByRole("table", { name: "Result for each address" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([
      "a@x.comInvited",
      "b@x.comNo seat left on the plan.",
      "c@x.comInvite create failed",
    ]);
    expect(within(form).getByRole("status").textContent).toMatch(/^1 invited, 2 not invited/);
    // The failed ones stay in the box to fix and resend.
    expect((within(form).getByLabelText("Email addresses") as HTMLTextAreaElement).value).toBe("b@x.com\nc@x.com");
  });

  it("reads an uploaded list into the box", async () => {
    routeApiFetch();
    render(<PeopleInvitesPage />);
    const form = (await screen.findByRole("heading", { name: "Invite a list" })).closest("section")!;
    const content = "email\nann@x.org\nbo@x.org\n";
    const file = new File([content], "people.csv", { type: "text/csv" });
    // jsdom's File has no text(); every browser's does.
    Object.defineProperty(file, "text", { value: () => Promise.resolve(content) });
    fireEvent.change(within(form).getByLabelText("Upload a list (CSV or text)"), { target: { files: [file] } });
    expect(await within(form).findByText(/2 addresses ready\./)).toBeTruthy();
  });

  it("copies a pending invite's link and revokes it after confirming", async () => {
    routeApiFetch({ invites: [invite(), invite({ id: 2, email: "old@example.com", status: "accepted" })] });
    render(<PeopleInvitesPage />);
    const pending = (await screen.findByText("new@example.com")).closest("li")!;
    expect(within(pending).getByText("Pending")).toBeTruthy();
    const accepted = screen.getByText("old@example.com").closest("li")!;
    expect(within(accepted).queryByRole("button")).toBeNull();

    fireEvent.click(within(pending).getByRole("button", { name: "Copy the invite link for new@example.com" }));
    expect(copyText).toHaveBeenCalledWith(expect.stringContaining("/invite/abc123"));
    expect(await screen.findByText("Invite link copied.")).toBeTruthy();

    fireEvent.click(within(pending).getByRole("button", { name: "Revoke the invite for new@example.com" }));
    expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Revoke invite?", danger: true }));
    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/organizations/1/invites/1/revoke", { method: "POST", token: "tok" }),
    );
    expect(await screen.findByText("Invite revoked.")).toBeTruthy();
  });
});
