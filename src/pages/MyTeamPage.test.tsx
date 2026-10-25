import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resetServerPermissionsCache } from "../lib/useCan";
import { myPermissions, SERVER_SESSION, serveMyPermissions } from "../test/myPermissions";

import { MyTeamPage } from "./MyTeamPage";
import type { TeamDetail } from "./TeamsPage";

const apiFetch = vi.fn();

vi.mock("../lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  friendlyErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
}));

let mockAuth: Record<string, unknown> = {};
vi.mock("../lib/auth", () => ({
  useAuth: () => mockAuth,
}));

const ENGINEERING = {
  id: 1,
  name: "Engineering",
  description: null,
  created_by: 1,
  created_at: null,
  member_count: 2,
};

const ENGINEERING_DETAIL: TeamDetail = {
  ...ENGINEERING,
  members: [
    { user_id: 1, username: "alice", email: "alice@example.com", team_role: "team_admin", joined_at: null },
    { user_id: 2, username: "bob", email: "bob@example.com", team_role: "member", joined_at: null },
  ],
};

function signInAsMember() {
  mockAuth = { token: "tok", username: "bob", role: "user", orgRole: "member", ...SERVER_SESSION };
}

function renderPage() {
  render(
    <MemoryRouter>
      <MyTeamPage />
    </MemoryRouter>,
  );
}

describe("MyTeamPage", () => {
  afterEach(() => {
    cleanup();
    apiFetch.mockReset();
    resetServerPermissionsCache();
  });

  it("falls back to every team, with no admin controls for a member, when /v1/me/permissions fails", async () => {
    signInAsMember();
    resetServerPermissionsCache();
    apiFetch.mockImplementation((path: string) => {
      if (path === "/v1/me/permissions") return Promise.reject(new Error("404"));
      if (path === "/v1/teams/1") return Promise.resolve(ENGINEERING_DETAIL);
      return Promise.resolve({ teams: [ENGINEERING], total: 1, limit: 50, offset: 0 });
    });
    renderPage();
    fireEvent.click(await screen.findByText("Engineering"));
    await screen.findByText("bob");
    // bob may leave; nothing else: no add, no role select, no removing alice.
    expect(screen.getByRole("button", { name: "Leave" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Member" })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("link", { name: "Open Teams" })).toBeNull();
  });

  it("tells a team-less member of an org with no teams to ask an admin", async () => {
    signInAsMember();
    apiFetch.mockImplementation(() => Promise.resolve({ teams: [], total: 0, limit: 50, offset: 0 }));
    serveMyPermissions(apiFetch, myPermissions({ orgKeys: ["org.members.view"] }));
    renderPage();
    expect(
      await screen.findByText(
        "Your organization has no teams yet. Ask an organization admin to create one or to add you.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Ask to join/ })).toBeNull();
  });
});
