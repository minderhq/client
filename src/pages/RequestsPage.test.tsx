import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InboxRequest, MyAccessRequest } from "../lib/accessRequests";
import { RequestsPage } from "./RequestsPage";

let mockAuth = {
  isAuthenticated: true,
  token: "tok",
  sessionKey: "s1",
  role: "user",
  orgRole: "member",
  isPlatformAdmin: false,
  activeTenantId: "7",
  tenantId: "7",
};
vi.mock("../lib/auth", () => ({ useAuth: () => mockAuth }));
vi.mock("../lib/useBillingAccess", () => ({ useBillingAccess: () => false }));

type Handler = (init: RequestInit) => { status?: number; body: unknown };
let routes: Record<string, Handler> = {};
const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = new URL(String(input), "http://localhost");
  const key = `${init.method ?? "GET"} ${url.pathname}${url.search}`;
  const handler = routes[key];
  if (!handler) throw new Error(`unexpected request ${key}`);
  const { status = 200, body } = handler(init);
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
});

const MINE = "GET /v1/access-requests";
const INBOX = "GET /v1/access-requests/inbox?status=all";

function list<T>(requests: T[]) {
  return () => ({ body: { requests, total: requests.length, limit: 50, offset: 0 } });
}

function mine(overrides: Partial<MyAccessRequest>): MyAccessRequest {
  return {
    id: 1,
    kind: "plugin_install",
    status: "pending",
    organization_id: 7,
    subject: "Weather",
    created_at: "2026-10-20T10:00:00+00:00",
    expires_at: "2026-11-03T10:00:00+00:00",
    ...overrides,
  };
}

function inboxItem(overrides: Partial<InboxRequest> = {}): InboxRequest {
  return {
    ...mine({ id: 10, note: "For the sales team" }),
    requester: { id: 5, username: "carol" },
    ...overrides,
  };
}

function signInAs(orgRole: "member" | "admin") {
  mockAuth = { ...mockAuth, orgRole };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <RequestsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  routes = { [MINE]: list([]), [INBOX]: list([]) };
});

afterEach(() => {
  cleanup();
  fetchMock.mockClear();
  vi.unstubAllGlobals();
  signInAs("member");
});

describe("RequestsPage: my requests", () => {
  it("shows each request's status, its expiry while pending and the rejection reason", async () => {
    routes[MINE] = list([
      mine({ id: 1 }),
      mine({ id: 2, kind: "model_request", subject: "llama3.1:8b", status: "approved", decided_at: "2026-10-21T10:00:00+00:00" }),
      mine({ id: 3, kind: "team_join", subject: null, team_id: 4, status: "denied", decision_reason: "Team is full" }),
      mine({ id: 4, status: "expired" }),
    ]);
    renderPage();

    const section = await screen.findByRole("region", { name: "My requests" });
    const items = await within(section).findAllByRole("listitem");
    expect(items.map((li) => li.querySelector("p")?.textContent)).toEqual([
      "Install a plugin: Weather",
      "Make a model available: llama3.1:8b",
      "Join a team: team #4",
      "Install a plugin: Weather",
    ]);
    expect(within(items[0]).getByText("Pending")).toBeTruthy();
    expect(items[0].textContent).toMatch(/closes on its own on/);
    expect(within(items[1]).getByText("Approved")).toBeTruthy();
    expect(within(items[2]).getByText("Rejected")).toBeTruthy();
    expect(items[2].textContent).toMatch(/Reason: Team is full/);
    expect(within(items[3]).getByText("Expired")).toBeTruthy();
  });

  it("explains how to ask when there are none, and shows no inbox to a plain member", async () => {
    renderPage();
    expect(await screen.findByText(/You haven't asked for anything yet/)).toBeTruthy();
    // Both lists, and nothing else (useCan's GET /v1/me/permissions aside).
    const requests = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("/v1/access-requests"));
    await waitFor(() => expect(requests()).toHaveLength(2));
    expect(screen.queryByRole("region", { name: "Waiting for your decision" })).toBeNull();
  });

  it("offers Retry when the list can't load", async () => {
    routes[MINE] = () => ({ status: 500, body: { detail: "boom" } });
    renderPage();
    expect(await screen.findByText("Couldn't load your requests.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Retry/ })).toBeTruthy();
  });
});

describe("RequestsPage: inbox", () => {
  it("shows an admin an empty inbox", async () => {
    signInAs("admin");
    renderPage();
    expect(await screen.findByText("No requests are waiting for you.")).toBeTruthy();
  });

  it("shows a team admin the join requests routed to them, without an org permission", async () => {
    routes[INBOX] = list([inboxItem({ kind: "team_join", subject: null, team_id: 4, team_name: "Sales" })]);
    renderPage();
    const inbox = await screen.findByRole("region", { name: "Waiting for your decision" });
    expect(await within(inbox).findByText("Join a team: Sales")).toBeTruthy();
  });

  it("approves in one click and says what to do next", async () => {
    signInAs("admin");
    let decided = false;
    routes[INBOX] = () =>
      list([decided ? inboxItem({ status: "approved", decided_by_username: "dana" }) : inboxItem()])();
    routes["POST /v1/organizations/7/access-requests/10/approve"] = () => {
      decided = true;
      return { body: { access_request: inboxItem({ status: "approved" }), follow_up: "install_plugin" } };
    };
    renderPage();

    const inbox = await screen.findByRole("region", { name: "Waiting for your decision" });
    expect(await within(inbox).findByText("Asked by carol · Oct 20, 2026")).toBeTruthy();
    expect(within(inbox).getByText("Note: For the sales team")).toBeTruthy();
    fireEvent.click(within(inbox).getByRole("button", { name: "Approve: Install a plugin: Weather, carol" }));

    expect(await within(inbox).findByText(/Now install the plugin from Discover plugins/)).toBeTruthy();
    expect(await within(inbox).findByText("Approved by dana.")).toBeTruthy();
    expect(within(inbox).queryByRole("button", { name: /^Approve/ })).toBeNull();
  });

  it("rejects with a reason the requester will see", async () => {
    signInAs("admin");
    let sent: unknown = null;
    routes[INBOX] = list([inboxItem()]);
    routes["POST /v1/organizations/7/access-requests/10/deny"] = (init) => {
      sent = JSON.parse(String(init.body));
      routes[INBOX] = list([
        inboxItem({ status: "denied", decided_by_username: "dana", decision_reason: "Not licensed" }),
      ]);
      return { body: inboxItem({ status: "denied" }) };
    };
    renderPage();

    const inbox = await screen.findByRole("region", { name: "Waiting for your decision" });
    fireEvent.click(await within(inbox).findByRole("button", { name: /^Reject/ }));
    const dialog = screen.getByRole("dialog", { name: "Reject this request?" });
    fireEvent.change(within(dialog).getByLabelText("Reason (the requester sees it)"), {
      target: { value: "Not licensed" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject request" }));

    expect(await within(inbox).findByText("Rejected by dana. Reason: Not licensed")).toBeTruthy();
    expect(sent).toEqual({ reason: "Not licensed" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says when another admin decided first, and shows who", async () => {
    signInAs("admin");
    routes[INBOX] = list([inboxItem()]);
    routes["POST /v1/organizations/7/access-requests/10/approve"] = () => {
      routes[INBOX] = list([inboxItem({ status: "approved", decided_by_username: "erin" })]);
      return { status: 409, body: { detail: "access_request_not_pending" } };
    };
    renderPage();

    const inbox = await screen.findByRole("region", { name: "Waiting for your decision" });
    fireEvent.click(await within(inbox).findByRole("button", { name: /^Approve/ }));
    expect(await within(inbox).findByText("Someone else decided this request first.")).toBeTruthy();
    expect(await within(inbox).findByText("Approved by erin.")).toBeTruthy();
  });
});
