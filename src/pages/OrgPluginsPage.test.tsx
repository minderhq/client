import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Installation } from "../lib/types";
import { OrgPluginsPage } from "./OrgPluginsPage";

const apiFetch = vi.fn();

vi.mock("../lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  friendlyErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
}));
vi.mock("../lib/auth", () => ({
  useAuth: () => ({ token: "tok", isAuthenticated: true, sessionKey: "s1" }),
}));
vi.mock("../components/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true), dialog: null }),
}));
vi.mock("react-router-dom", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

function installation(overrides: Partial<Installation> = {}): Installation {
  return {
    installation_id: "i1",
    plugin_id: "p1",
    version: "1.0.0",
    status: "active",
    enabled: true,
    installed_at: "2026-01-01T00:00:00Z",
    last_updated_at: "2026-01-01T00:00:00Z",
    name: "weather",
    display_name: "Weather",
    description: null,
    current_version: "1.0.0",
    pricing_model: "free",
    base_tier: "community",
    category_id: null,
    author: null,
    requires_services: [],
    origin: "first_party",
    ...overrides,
  } as Installation;
}

function mockApi({
  installations = [] as Installation[] | Error | Promise<never>,
  inbox = [] as { id: number; kind: string; status: string }[],
}) {
  apiFetch.mockImplementation((path: string) => {
    if (path === "/v1/marketplace/installations/me") {
      if (installations instanceof Error || installations instanceof Promise) {
        return installations instanceof Error ? Promise.reject(installations) : installations;
      }
      return Promise.resolve({ installations, count: installations.length });
    }
    if (path.startsWith("/v1/plugins?"))
      return Promise.resolve({ plugins: [], count: 0, total: 0, limit: 500, offset: 0 });
    if (path === "/v1/access-requests/inbox?status=pending")
      return Promise.resolve({ requests: inbox, total: inbox.length });
    return Promise.resolve({});
  });
}

afterEach(() => {
  cleanup();
  apiFetch.mockReset();
});

describe("OrgPluginsPage", () => {
  it("shows placeholder cards while the installs load", () => {
    mockApi({ installations: new Promise<never>(() => {}) });
    render(<OrgPluginsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Organization plugins" })).toBeTruthy();
    expect(screen.getByTestId("card-list-skeleton")).toBeTruthy();
  });

  it("says nothing is installed for the org, and points to Discover", async () => {
    // A personal install is not the org's.
    mockApi({ installations: [installation({ tenant_id: null })] });
    render(<OrgPluginsPage />);
    expect(await screen.findByText(/No plugins are installed for the organization yet/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Find one in Discover" }).getAttribute("href")).toBe(
      "/marketplace/discover/plugins",
    );
    expect(screen.queryByRole("heading", { level: 3, name: "Weather" })).toBeNull();
  });

  it("explains a failed load and retries", async () => {
    mockApi({ installations: new Error("marketplace down") });
    render(<OrgPluginsPage />);
    expect(await screen.findByText("Couldn't load the organization's plugins.")).toBeTruthy();
    expect(screen.getByText("marketplace down")).toBeTruthy();
    mockApi({ installations: [installation({ tenant_id: "7" })] });
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(await screen.findByRole("heading", { level: 3, name: "Weather" })).toBeTruthy();
  });

  it("lists only the org's installs, marked, with the admin's actions", async () => {
    mockApi({
      installations: [
        installation({ tenant_id: "7" }),
        installation({ installation_id: "i2", plugin_id: "p2", name: "news", display_name: "News" }),
      ],
    });
    render(<OrgPluginsPage />);
    expect(await screen.findByRole("heading", { level: 3, name: "Weather" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 3, name: "News" })).toBeNull();
    expect(screen.getByText("Installed for your organization")).toBeTruthy();
    expect(screen.getByText("Organization install: Enabled")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Disable Weather" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Uninstall Weather" })).toBeTruthy();
  });

  it("counts pending plugin install requests and links to the Requests inbox", async () => {
    mockApi({
      inbox: [
        { id: 1, kind: "plugin_install", status: "pending" },
        { id: 2, kind: "plugin_install", status: "pending" },
        { id: 3, kind: "team_join", status: "pending" },
      ],
    });
    render(<OrgPluginsPage />);
    expect(
      await screen.findByText("2 plugin install requests are waiting for a decision."),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Requests" }).getAttribute("href")).toBe("/organization/people/requests");
  });

  it("shows no request line when none wait", async () => {
    mockApi({});
    render(<OrgPluginsPage />);
    await waitFor(() => expect(screen.getByText(/No plugins are installed/)).toBeTruthy());
    expect(screen.queryByRole("link", { name: "Open Requests" })).toBeNull();
  });
});
