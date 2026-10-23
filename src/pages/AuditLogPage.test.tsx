import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuditLogPage } from "./AuditLogPage";

const apiFetch = vi.fn();

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => apiFetch(...args),
  };
});

const SIGNED_OUT = { isAuthenticated: false, token: "", isPlatformAdmin: false, activeTenantId: "" };
let mockAuth = SIGNED_OUT;
vi.mock("../lib/auth", () => ({
  useAuth: () => mockAuth,
}));

interface Entry {
  id: number;
  actor_id: number | null;
  action: string;
  target_type: string;
  target_id: string | null;
  before_state: unknown;
  after_state: unknown;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string | null;
}

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 1,
    actor_id: 7,
    action: "ORG_MEMBER_ADDED",
    target_type: "org_member",
    target_id: "42",
    before_state: null,
    after_state: { role: "member" },
    ip_address: "10.0.0.1",
    user_agent: "Mozilla/5.0",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function page(entries: Entry[], total = entries.length) {
  return { entries, total, limit: 50, offset: 0 };
}

describe("AuditLogPage", () => {
  afterEach(() => {
    cleanup();
    apiFetch.mockReset();
    mockAuth = SIGNED_OUT;
  });

  it("shows the admin-only gate when logged out and never fetches", () => {
    render(<AuditLogPage />);
    expect(
      screen.getByText("Admins only — log in with an admin account to view the audit log."),
    ).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("reads the active org's log for an org admin without the Platform Admin claim", async () => {
    mockAuth = { ...SIGNED_OUT, isAuthenticated: true, token: "tok", activeTenantId: "5" };
    apiFetch.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/v1/organizations/mine"
          ? {
              organizations: [
                { id: 3, name: "Home Org", is_home: true },
                { id: 5, name: "Acme", is_home: false },
              ],
            }
          : page([entry()]),
      ),
    );
    render(<AuditLogPage />);

    await screen.findByText("ORG_MEMBER_ADDED");
    expect(screen.getByText(/Acme/)).toBeTruthy();
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/organizations/5/audit-logs?limit=50&offset=0",
      { token: "tok", signal: expect.any(AbortSignal) },
    );
    // Never the instance-wide API, which answers 403 without the claim.
    expect(apiFetch.mock.calls.some(([p]) => String(p).startsWith("/v1/audit-logs"))).toBe(false);
  });

  it("says so and fetches no log when the caller has no organization", async () => {
    mockAuth = { ...SIGNED_OUT, isAuthenticated: true, token: "tok" };
    apiFetch.mockResolvedValue({ organizations: [] });
    render(<AuditLogPage />);

    await screen.findByText("You're not in an organization, so there's no audit log to show.");
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("reads the instance-wide log for a Platform Admin", async () => {
    mockAuth = { ...SIGNED_OUT, isAuthenticated: true, token: "tok", isPlatformAdmin: true };
    apiFetch.mockResolvedValue(page([entry()]));
    render(<AuditLogPage />);

    await screen.findByText("ORG_MEMBER_ADDED");
    expect(screen.getByText("org_member")).toBeTruthy();
    expect(screen.getByText("actor #7", { exact: false })).toBeTruthy();
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/audit-logs?limit=50&offset=0",
      { token: "tok", signal: expect.any(AbortSignal) },
    );
  });

  it("shows an unfiltered empty state when there are no entries at all", async () => {
    mockAuth = { ...SIGNED_OUT, isAuthenticated: true, token: "tok", isPlatformAdmin: true };
    apiFetch.mockResolvedValue(page([]));
    render(<AuditLogPage />);

    await screen.findByText("No audit entries yet.");
  });

  it("shows a filtered empty-state message once a filter is active", async () => {
    mockAuth = { ...SIGNED_OUT, isAuthenticated: true, token: "tok", isPlatformAdmin: true };
    apiFetch.mockResolvedValue(page([]));
    render(<AuditLogPage />);
    await screen.findByText("No audit entries yet.");

    fireEvent.change(screen.getByLabelText("Filter by action"), {
      target: { value: "ORG_MEMBER_REMOVED" },
    });

    await screen.findByText("No audit entries match these filters.");
  });

  it("debounces the action/target filters and re-fetches with the right query params", async () => {
    mockAuth = { ...SIGNED_OUT, isAuthenticated: true, token: "tok", isPlatformAdmin: true };
    apiFetch.mockResolvedValue(page([entry()]));
    render(<AuditLogPage />);
    await screen.findByText("ORG_MEMBER_ADDED");
    apiFetch.mockClear();

    fireEvent.change(screen.getByLabelText("Filter by action"), {
      target: { value: "ORG_MEMBER_REMOVED" },
    });
    fireEvent.change(screen.getByLabelText("Filter by target type"), {
      target: { value: "org_member" },
    });

    await vi.waitFor(
      () =>
        expect(apiFetch).toHaveBeenCalledWith(
          "/v1/audit-logs?limit=50&offset=0&action=ORG_MEMBER_REMOVED&target_type=org_member",
          { token: "tok", signal: expect.any(AbortSignal) },
        ),
      { timeout: 1000 },
    );
  });

  it("expands a row to show before/after state and user agent", async () => {
    mockAuth = { ...SIGNED_OUT, isAuthenticated: true, token: "tok", isPlatformAdmin: true };
    apiFetch.mockResolvedValue(
      page([entry({ before_state: { role: "viewer" }, after_state: { role: "member" } })]),
    );
    render(<AuditLogPage />);
    await screen.findByText("ORG_MEMBER_ADDED");

    expect(screen.queryByText("Before")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Details/ }));

    expect(screen.getByText("Before")).toBeTruthy();
    expect(screen.getByText("After")).toBeTruthy();
    expect(screen.getByText(/Mozilla\/5\.0/)).toBeTruthy();
  });

  it("hides the Details toggle when a row has no before/after/user-agent data", async () => {
    mockAuth = { ...SIGNED_OUT, isAuthenticated: true, token: "tok", isPlatformAdmin: true };
    apiFetch.mockResolvedValue(
      page([entry({ before_state: null, after_state: null, user_agent: null })]),
    );
    render(<AuditLogPage />);
    await screen.findByText("ORG_MEMBER_ADDED");

    expect(screen.queryByRole("button", { name: /Details/ })).toBeNull();
  });

  it("paginates: Next advances the offset, Previous is disabled on the first page", async () => {
    mockAuth = { ...SIGNED_OUT, isAuthenticated: true, token: "tok", isPlatformAdmin: true };
    const entries = Array.from({ length: 50 }, (_, i) => entry({ id: i + 1 }));
    apiFetch.mockResolvedValue(page(entries, 120));
    render(<AuditLogPage />);
    await screen.findAllByText("1–50 of 120", { exact: false });

    expect(
      (screen.getByRole("button", { name: /Previous/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    apiFetch.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/v1/audit-logs?limit=50&offset=50",
        { token: "tok", signal: expect.any(AbortSignal) },
      ),
    );
  });

  it("disables Next once the last page is reached", async () => {
    mockAuth = { ...SIGNED_OUT, isAuthenticated: true, token: "tok", isPlatformAdmin: true };
    const firstPage = Array.from({ length: 50 }, (_, i) => entry({ id: i + 1 }));
    apiFetch.mockImplementation((path: string) => {
      if (path.includes("offset=50")) return Promise.resolve(page([entry({ id: 51 })], 51));
      return Promise.resolve(page(firstPage, 51));
    });
    render(<AuditLogPage />);
    await screen.findAllByText("1–50 of 51", { exact: false });
    expect(
      (screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled,
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await screen.findAllByText("51–51 of 51", { exact: false });
    expect(
      (screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("hides pagination controls when everything fits on one page", async () => {
    mockAuth = { ...SIGNED_OUT, isAuthenticated: true, token: "tok", isPlatformAdmin: true };
    apiFetch.mockResolvedValue(page([entry()], 1));
    render(<AuditLogPage />);
    await screen.findByText("ORG_MEMBER_ADDED");

    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Previous/ })).toBeNull();
  });

  it("reloads on demand via the Refresh button", async () => {
    mockAuth = { ...SIGNED_OUT, isAuthenticated: true, token: "tok", isPlatformAdmin: true };
    apiFetch.mockResolvedValue(page([entry()]));
    render(<AuditLogPage />);
    await screen.findByText("ORG_MEMBER_ADDED");
    apiFetch.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));

    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
  });
});
