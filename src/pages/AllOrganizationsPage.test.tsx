import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DirectoryUser, OrgListItem } from "../lib/orgs";
import { AllOrganizationsPage } from "./AllOrganizationsPage";

const apiFetch = vi.fn();

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => apiFetch(...args),
  };
});

let mockAuth = { isAuthenticated: false, token: "", role: "" };
vi.mock("../lib/auth", () => ({
  useAuth: () => mockAuth,
}));

function org(overrides: Partial<OrgListItem> = {}): OrgListItem {
  return {
    id: 1,
    name: "Acme Corporation",
    slug: "acme",
    created_by: 1,
    member_count: 3,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function user(overrides: Partial<DirectoryUser> = {}): DirectoryUser {
  return { id: 1, username: "alice", email: "alice@example.com", ...overrides };
}

describe("AllOrganizationsPage", () => {
  afterEach(() => {
    apiFetch.mockReset();
    mockAuth = { isAuthenticated: false, token: "", role: "" };
    cleanup();
  });

  it("gates the page behind admin and never fetches otherwise", () => {
    mockAuth = { isAuthenticated: true, token: "tok", role: "user" };
    render(<AllOrganizationsPage />);
    expect(
      screen.getByText("Admins only — log in with an admin account to manage organizations."),
    ).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("shows the same admin-only gate when logged out entirely", () => {
    render(<AllOrganizationsPage />);
    expect(
      screen.getByText("Admins only — log in with an admin account to manage organizations."),
    ).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("fetches and renders organizations for an admin", async () => {
    mockAuth = { isAuthenticated: true, token: "tok", role: "admin" };
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/v1/organizations"))
        return Promise.resolve({ organizations: [org()], total: 1, limit: 200, offset: 0 });
      if (path === "/v1/auth/users") return Promise.resolve({ users: [user()] });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    render(<AllOrganizationsPage />);

    await screen.findByText("Acme Corporation");
    expect(screen.getByText("acme")).toBeTruthy();
    expect(screen.getByText("3 members")).toBeTruthy();
  });

  it("shows an empty state when there are no organizations", async () => {
    mockAuth = { isAuthenticated: true, token: "tok", role: "admin" };
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/v1/organizations"))
        return Promise.resolve({ organizations: [], total: 0, limit: 200, offset: 0 });
      if (path === "/v1/auth/users") return Promise.resolve({ users: [] });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    render(<AllOrganizationsPage />);

    await screen.findByText("No organizations yet — create the first one above.");
  });

  it("auto-derives the slug from the name until the slug field is edited directly", async () => {
    mockAuth = { isAuthenticated: true, token: "tok", role: "admin" };
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/v1/organizations"))
        return Promise.resolve({ organizations: [], total: 0, limit: 200, offset: 0 });
      if (path === "/v1/auth/users") return Promise.resolve({ users: [] });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    render(<AllOrganizationsPage />);
    await screen.findByText("No organizations yet — create the first one above.");

    fireEvent.change(screen.getByPlaceholderText("Acme Corporation"), {
      target: { value: "Widget Co!!" },
    });
    expect((screen.getByPlaceholderText("acme") as HTMLInputElement).value).toBe("widget-co");

    // Once the user edits the slug directly, further name changes must not
    // clobber their choice.
    fireEvent.change(screen.getByPlaceholderText("acme"), { target: { value: "custom" } });
    fireEvent.change(screen.getByPlaceholderText("Acme Corporation"), {
      target: { value: "Widget Co Renamed" },
    });
    expect((screen.getByPlaceholderText("acme") as HTMLInputElement).value).toBe("custom");
  });

  it("creates an organization and reloads the list", async () => {
    mockAuth = { isAuthenticated: true, token: "tok", role: "admin" };
    apiFetch.mockImplementation((path: string, opts?: { method?: string }) => {
      if (opts?.method === "POST" && path === "/v1/organizations") {
        return Promise.resolve({ id: "2", name: "Widget Co", slug: "widget-co" });
      }
      if (path.startsWith("/v1/organizations"))
        return Promise.resolve({ organizations: [], total: 0, limit: 200, offset: 0 });
      if (path === "/v1/auth/users") return Promise.resolve({ users: [] });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    render(<AllOrganizationsPage />);
    await screen.findByText("No organizations yet — create the first one above.");

    fireEvent.change(screen.getByPlaceholderText("Acme Corporation"), {
      target: { value: "Widget Co" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create organization" }));

    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/organizations", {
        method: "POST",
        body: { name: "Widget Co", slug: "widget-co", owner_user_id: undefined },
        token: "tok",
      }),
    );
    await screen.findByText("Organization created.");
  });

  it("rejects submission when name or slug is blank, without calling the API", async () => {
    mockAuth = { isAuthenticated: true, token: "tok", role: "admin" };
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/v1/organizations"))
        return Promise.resolve({ organizations: [], total: 0, limit: 200, offset: 0 });
      if (path === "/v1/auth/users") return Promise.resolve({ users: [] });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    render(<AllOrganizationsPage />);
    await screen.findByText("No organizations yet — create the first one above.");

    fireEvent.click(screen.getByRole("button", { name: "Create organization" }));

    await screen.findByText("Name and slug are required.");
    expect(apiFetch).not.toHaveBeenCalledWith(
      "/v1/organizations",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows a friendly error when creation fails", async () => {
    mockAuth = { isAuthenticated: true, token: "tok", role: "admin" };
    apiFetch.mockImplementation((path: string, opts?: { method?: string }) => {
      if (opts?.method === "POST" && path === "/v1/organizations") {
        return Promise.reject(new Error("slug already taken"));
      }
      if (path.startsWith("/v1/organizations"))
        return Promise.resolve({ organizations: [], total: 0, limit: 200, offset: 0 });
      if (path === "/v1/auth/users") return Promise.resolve({ users: [] });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    render(<AllOrganizationsPage />);
    await screen.findByText("No organizations yet — create the first one above.");

    fireEvent.change(screen.getByPlaceholderText("Acme Corporation"), {
      target: { value: "Widget Co" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create organization" }));

    await screen.findByText("slug already taken");
  });

  it("filters the list by name or slug once there are more than 5 organizations", async () => {
    mockAuth = { isAuthenticated: true, token: "tok", role: "admin" };
    const orgs = Array.from({ length: 6 }, (_, i) =>
      org({ id: i + 1, name: `Org ${i + 1}`, slug: `org-${i + 1}` }),
    );
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/v1/organizations"))
        return Promise.resolve({ organizations: orgs, total: orgs.length, limit: 200, offset: 0 });
      if (path === "/v1/auth/users") return Promise.resolve({ users: [] });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    render(<AllOrganizationsPage />);
    await screen.findByText("Org 1");

    fireEvent.change(screen.getByLabelText("Filter organizations"), {
      target: { value: "org-3" },
    });

    expect(screen.getByText("Org 3")).toBeTruthy();
    expect(screen.queryByText("Org 1")).toBeNull();
  });

  it("shows a no-match empty state when the filter matches nothing", async () => {
    mockAuth = { isAuthenticated: true, token: "tok", role: "admin" };
    const orgs = Array.from({ length: 6 }, (_, i) =>
      org({ id: i + 1, name: `Org ${i + 1}`, slug: `org-${i + 1}` }),
    );
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/v1/organizations"))
        return Promise.resolve({ organizations: orgs, total: orgs.length, limit: 200, offset: 0 });
      if (path === "/v1/auth/users") return Promise.resolve({ users: [] });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    render(<AllOrganizationsPage />);
    await screen.findByText("Org 1");

    fireEvent.change(screen.getByLabelText("Filter organizations"), {
      target: { value: "nonexistent" },
    });

    await screen.findByText('No organizations match "nonexistent".');
  });
});
