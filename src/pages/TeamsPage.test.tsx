import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TeamsPage, type Team, type TeamDetail } from "./TeamsPage";

const apiFetch = vi.fn();

vi.mock("../lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  friendlyErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
}));

const loginWithToken = vi.fn();
let mockAuth = { token: "", username: "", role: "", loginWithToken };
vi.mock("../lib/auth", () => ({
  useAuth: () => mockAuth,
}));

function team(overrides: Partial<Team> = {}): Team {
  return {
    id: 1,
    name: "Engineering",
    description: null,
    created_by: 1,
    created_at: "2026-01-01T00:00:00Z",
    member_count: 2,
    ...overrides,
  };
}

function detail(overrides: Partial<TeamDetail> = {}): TeamDetail {
  return {
    id: 1,
    name: "Engineering",
    description: null,
    created_by: 1,
    created_at: "2026-01-01T00:00:00Z",
    members: [
      {
        user_id: 1,
        username: "alice",
        email: "alice@example.com",
        team_role: "team_admin",
        joined_at: "2026-01-01T00:00:00Z",
      },
      {
        user_id: 2,
        username: "bob",
        email: "bob@example.com",
        team_role: "member",
        joined_at: "2026-01-01T00:00:00Z",
      },
    ],
    ...overrides,
  };
}

describe("TeamsPage", () => {
  afterEach(() => {
    apiFetch.mockReset();
    loginWithToken.mockReset();
    mockAuth = { token: "", username: "", role: "", loginWithToken };
    cleanup();
  });

  it("shows a login hint and never fetches when logged out", () => {
    render(<TeamsPage />);
    expect(screen.getByText("Log in to view or create teams.")).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("fetches and renders teams for a logged-in user", async () => {
    mockAuth = { token: "tok", username: "alice", role: "user", loginWithToken };
    apiFetch.mockResolvedValue({ teams: [team()], total: 1, limit: 50, offset: 0 });
    render(<TeamsPage />);

    await screen.findByText("Engineering");
    expect(screen.getByText("2 members")).toBeTruthy();
  });

  it("shows an empty state when there are no teams", async () => {
    mockAuth = { token: "tok", username: "alice", role: "user", loginWithToken };
    apiFetch.mockResolvedValue({ teams: [], total: 0, limit: 50, offset: 0 });
    render(<TeamsPage />);

    await screen.findByText("No teams yet — create one above.");
  });

  it("creates a team and reloads the list", async () => {
    mockAuth = { token: "tok", username: "alice", role: "user", loginWithToken };
    apiFetch.mockImplementation((path: string, opts?: { method?: string }) => {
      if (opts?.method === "POST" && path === "/v1/teams") {
        return Promise.resolve({ ...team(), access_token: "fresh.jwt.token", expires_in: 3600 });
      }
      return Promise.resolve({ teams: [], total: 0, limit: 50, offset: 0 });
    });
    render(<TeamsPage />);
    await screen.findByText("No teams yet — create one above.");

    fireEvent.change(screen.getByPlaceholderText("Team name"), {
      target: { value: "Engineering" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Team" }));

    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/teams", {
        method: "POST",
        token: "tok",
        body: { name: "Engineering", description: null },
      }),
    );
  });

  it("stores the fresh token the server mints on team creation (#1148)", async () => {
    // The creator becomes this team's team_admin at this exact moment --
    // their existing token predates that membership, so create must return
    // (and the page must store) an updated one, or they couldn't share
    // their own new team's content until an unrelated full logout/login.
    mockAuth = { token: "tok", username: "alice", role: "user", loginWithToken };
    apiFetch.mockImplementation((path: string, opts?: { method?: string }) => {
      if (opts?.method === "POST" && path === "/v1/teams") {
        return Promise.resolve({ ...team(), access_token: "fresh.jwt.token", expires_in: 3600 });
      }
      return Promise.resolve({ teams: [], total: 0, limit: 50, offset: 0 });
    });
    render(<TeamsPage />);
    await screen.findByText("No teams yet — create one above.");

    fireEvent.change(screen.getByPlaceholderText("Team name"), {
      target: { value: "Engineering" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Team" }));

    await vi.waitFor(() =>
      expect(loginWithToken).toHaveBeenCalledWith("fresh.jwt.token"),
    );
  });

  it("lazily fetches team detail on expand and renders members", async () => {
    mockAuth = { token: "tok", username: "alice", role: "user", loginWithToken };
    apiFetch.mockImplementation((path: string) => {
      if (path === "/v1/teams/1") return Promise.resolve(detail());
      if (path.startsWith("/v1/invites"))
        return Promise.resolve({ invites: [], total: 0, limit: 50, offset: 0 });
      return Promise.resolve({ teams: [team()], total: 1, limit: 50, offset: 0 });
    });
    render(<TeamsPage />);
    await screen.findByText("Engineering");
    expect(apiFetch).not.toHaveBeenCalledWith(
      "/v1/teams/1",
      expect.anything(),
    );

    fireEvent.click(screen.getByText("Engineering"));

    await screen.findByText("bob");
    expect(screen.getByText("alice")).toBeTruthy();
    // Wait for InvitesSection's own (independent) fetch effect to fire too,
    // so no promise is left pending against this test's soon-to-be-reset
    // apiFetch mock once afterEach runs.
    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringContaining("/v1/invites?team_id="),
        expect.anything(),
      ),
    );
  });

  it("a plain member only sees a Leave button for their own row", async () => {
    mockAuth = { token: "tok", username: "bob", role: "user", loginWithToken };
    apiFetch.mockImplementation((path: string) => {
      if (path === "/v1/teams/1") return Promise.resolve(detail());
      if (path.startsWith("/v1/invites"))
        return Promise.resolve({ invites: [], total: 0, limit: 50, offset: 0 });
      return Promise.resolve({ teams: [team()], total: 1, limit: 50, offset: 0 });
    });
    render(<TeamsPage />);
    await screen.findByText("Engineering");
    fireEvent.click(screen.getByText("Engineering"));
    await screen.findByText("bob");

    expect(screen.getByRole("button", { name: "Leave" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("a team_admin member sees management controls for other members", async () => {
    mockAuth = { token: "tok", username: "alice", role: "user", loginWithToken };
    apiFetch.mockImplementation((path: string) => {
      if (path === "/v1/teams/1") return Promise.resolve(detail());
      if (path.startsWith("/v1/invites"))
        return Promise.resolve({ invites: [], total: 0, limit: 50, offset: 0 });
      return Promise.resolve({ teams: [team()], total: 1, limit: 50, offset: 0 });
    });
    render(<TeamsPage />);
    await screen.findByText("Engineering");
    fireEvent.click(screen.getByText("Engineering"));
    await screen.findByText("bob");

    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Leave" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add Member" })).toBeTruthy();
    expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0);
    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringContaining("/v1/invites?team_id="),
        expect.anything(),
      ),
    );
  });

  it("adds a member by email, not a raw user_id (#1072)", async () => {
    mockAuth = { token: "tok", username: "alice", role: "user", loginWithToken };
    apiFetch.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === "/v1/teams/1/members" && opts?.method === "POST")
        return Promise.resolve({});
      if (path === "/v1/teams/1") return Promise.resolve(detail());
      if (path.startsWith("/v1/invites"))
        return Promise.resolve({ invites: [], total: 0, limit: 50, offset: 0 });
      return Promise.resolve({ teams: [team()], total: 1, limit: 50, offset: 0 });
    });
    render(<TeamsPage />);
    await screen.findByText("Engineering");
    fireEvent.click(screen.getByText("Engineering"));
    await screen.findByText("bob");

    fireEvent.change(screen.getByPlaceholderText("Existing member's email"), {
      target: { value: "newperson@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Member" }));

    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/teams/1/members", {
        method: "POST",
        token: "tok",
        body: { email: "newperson@example.com", team_role: "member" },
      }),
    );

    // #1148: the added member isn't the caller, so we can't refresh their JWT
    // here -- the UI must tell the admin the member needs a fresh login before
    // team-shared content is visible to them.
    await screen.findByText(/log out and back in/i);
  });

  it("an instance admin sees management controls even without team membership", async () => {
    mockAuth = { token: "tok", username: "carol", role: "admin", loginWithToken };
    apiFetch.mockImplementation((path: string) => {
      if (path === "/v1/teams/1") return Promise.resolve(detail());
      if (path.startsWith("/v1/invites"))
        return Promise.resolve({ invites: [], total: 0, limit: 50, offset: 0 });
      return Promise.resolve({ teams: [team()], total: 1, limit: 50, offset: 0 });
    });
    render(<TeamsPage />);
    await screen.findByText("Engineering");
    fireEvent.click(screen.getByText("Engineering"));
    await screen.findByText("bob");

    expect(screen.getByRole("button", { name: "Add Member" })).toBeTruthy();
    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringContaining("/v1/invites?team_id="),
        expect.anything(),
      ),
    );
  });

  it("removing a member issues a DELETE and reloads", async () => {
    mockAuth = { token: "tok", username: "alice", role: "user", loginWithToken };
    apiFetch.mockImplementation((path: string, opts?: { method?: string }) => {
      if (opts?.method === "DELETE") return Promise.resolve({});
      if (path === "/v1/teams/1") return Promise.resolve(detail());
      if (path.startsWith("/v1/invites"))
        return Promise.resolve({ invites: [], total: 0, limit: 50, offset: 0 });
      return Promise.resolve({ teams: [team()], total: 1, limit: 50, offset: 0 });
    });
    render(<TeamsPage />);
    await screen.findByText("Engineering");
    fireEvent.click(screen.getByText("Engineering"));
    await screen.findByText("bob");

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/teams/1/members/2", {
        method: "DELETE",
        token: "tok",
      }),
    );
  });

  it("a team_admin can send an invite and see the resulting link", async () => {
    mockAuth = { token: "tok", username: "alice", role: "user", loginWithToken };
    apiFetch.mockImplementation((path: string, opts?: { method?: string }) => {
      if (opts?.method === "POST" && path === "/v1/invites") {
        return Promise.resolve({
          id: 1,
          email: "new@example.com",
          team_id: 1,
          team_role: "member",
          invited_by: 1,
          token: "abc123",
          status: "pending",
          created_at: null,
          expires_at: null,
        });
      }
      if (path === "/v1/teams/1") return Promise.resolve(detail());
      if (path.startsWith("/v1/invites"))
        return Promise.resolve({ invites: [], total: 0, limit: 50, offset: 0 });
      return Promise.resolve({ teams: [team()], total: 1, limit: 50, offset: 0 });
    });
    render(<TeamsPage />);
    await screen.findByText("Engineering");
    fireEvent.click(screen.getByText("Engineering"));
    await screen.findByText("bob");

    fireEvent.change(screen.getByPlaceholderText("Email address"), {
      target: { value: "new@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send Invite" }));

    await screen.findByText(/abc123/);
    expect(apiFetch).toHaveBeenCalledWith("/v1/invites", {
      method: "POST",
      token: "tok",
      body: { email: "new@example.com", team_id: 1, team_role: "member" },
    });
  });

  it("a team_admin can revoke a pending invite", async () => {
    mockAuth = { token: "tok", username: "alice", role: "user", loginWithToken };
    apiFetch.mockImplementation((path: string, opts?: { method?: string }) => {
      if (opts?.method === "POST" && path === "/v1/invites/5/revoke") {
        return Promise.resolve({});
      }
      if (path === "/v1/teams/1") return Promise.resolve(detail());
      if (path.startsWith("/v1/invites")) {
        return Promise.resolve({
          invites: [
            {
              id: 5,
              email: "pending@example.com",
              team_id: 1,
              team_role: "member",
              invited_by: 1,
              token: "tok5",
              status: "pending",
              created_at: null,
              expires_at: null,
            },
          ],
          total: 1,
          limit: 50,
          offset: 0,
        });
      }
      return Promise.resolve({ teams: [team()], total: 1, limit: 50, offset: 0 });
    });
    render(<TeamsPage />);
    await screen.findByText("Engineering");
    fireEvent.click(screen.getByText("Engineering"));
    await screen.findByText("pending@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/invites/5/revoke", {
        method: "POST",
        token: "tok",
      }),
    );
  });
});
