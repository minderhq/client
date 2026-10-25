import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetServerPermissionsCache } from "../lib/useCan";
import { myPermissions, SERVER_SESSION } from "../test/myPermissions";
import { Sidebar } from "./Sidebar";

// Mutable per test (like AvailablePluginsPage.test.tsx's mockAuth) so both
// the non-admin (default) and admin (Review Queue visible) paths are covered.
let mockAuth: {
  isAuthenticated: boolean;
  role: string;
  orgRole?: string;
  isPlatformAdmin?: boolean;
  token?: string;
  sessionKey?: string;
} = { isAuthenticated: true, role: "" };
vi.mock("../lib/auth", () => ({
  useAuth: () => mockAuth,
}));

let mockBilling = true;
vi.mock("../lib/useBillingAccess", () => ({
  useBillingAccess: () => mockBilling,
}));

describe("Sidebar", () => {
  beforeEach(() => {
    mockAuth = { isAuthenticated: true, role: "" };
    mockBilling = true;
  });

  it("shows Plan & billing only to callers who may view billing (#64), and no personal Licenses", () => {
    const { unmount } = render(
      <MemoryRouter>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Plan & billing").closest("a")?.getAttribute("href")).toBe(
      "/organization/billing",
    );
    expect(screen.queryByText("Licenses")).toBeNull();
    unmount();
    mockBilling = false;
    render(
      <MemoryRouter>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByText("Plan & billing")).toBeNull();
  });

  it("shows a signed-out visitor no menu", () => {
    mockAuth = { isAuthenticated: false, role: "" };
    render(
      <MemoryRouter>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).queryAllByRole("link")).toEqual([]);
  });

  it("draws one divider above the administration sections", () => {
    mockAuth = { isAuthenticated: true, role: "admin", isPlatformAdmin: true };
    render(
      <MemoryRouter>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    const divided = screen
      .getAllByRole("group")
      .filter((g) => g.className.includes("border-t"))
      .map((g) => g.getAttribute("aria-labelledby") && g.querySelector("p")?.textContent);
    expect(divided).toEqual(["Organization"]);
  });
  afterEach(cleanup);

  it("links the wordmark to home and every section's nav items to their routes", () => {
    render(
      <MemoryRouter>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );

    expect(screen.getByText("Minder").closest("a")?.getAttribute("href")).toBe("/");
    const href = (label: string) => screen.getByText(label).closest("a")?.getAttribute("href");
    expect(href("Chat")).toBe("/ask");
    expect(href("Knowledge")).toBe("/rag");
    expect(href("Assistants")).toBe("/rag/pipelines");
    expect(href("Discover")).toBe("/marketplace/discover/plugins");
    expect(href("My team")).toBe("/team");
    expect(href("My account")).toBe("/account");
  });

  it("renders every section label", () => {
    render(
      <MemoryRouter>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );

    // Billing is visible (mockBilling), so the Organization section shows.
    for (const label of ["Use", "Build", "Me", "Organization"]) {
      expect(screen.getByRole("group", { name: label })).toBeTruthy();
    }
  });

  it("calls onNavigate when a nav link is clicked", () => {
    const onNavigate = vi.fn();
    render(
      <MemoryRouter>
        <Sidebar open={true} onNavigate={onNavigate} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("Assistants"));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("calls onNavigate when the wordmark is clicked", () => {
    const onNavigate = vi.fn();
    render(
      <MemoryRouter>
        <Sidebar open={true} onNavigate={onNavigate} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("Minder"));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("translates on/off screen based on the open prop", () => {
    const { rerender } = render(
      <MemoryRouter>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Minder").closest("aside")?.className).toContain(
      "-translate-x-full",
    );

    rerender(
      <MemoryRouter>
        <Sidebar open={true} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Minder").closest("aside")?.className).toContain(
      "translate-x-0",
    );
  });

  it("marks the active route's link distinctly from inactive ones", () => {
    render(
      <MemoryRouter initialEntries={["/rag/pipelines"]}>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );

    expect(screen.getByText("Assistants").className).toContain("bg-indigo-50");
    expect(screen.getByText("Knowledge").className).not.toContain(
      "bg-indigo-50",
    );
  });

  it("shows Build as Knowledge / Assistants / Discover, with no AI tools, modules or Publish", () => {
    render(
      <MemoryRouter>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );

    const build = screen.getByRole("group", { name: "Build" });
    expect(within(build).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Knowledge",
      "Assistants",
      "Discover",
    ]);
    for (const old of ["Installed", "AI tools", "Service bundles", "Modules", "Publish", "Models", "Status"]) {
      expect(screen.queryByText(old)).toBeNull();
    }
  });

  it("shows Platform › MindHub & sources to an operator only", () => {
    const { unmount } = render(
      <MemoryRouter>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    // A non-operator sees no Platform section at all, not an empty heading.
    expect(screen.queryByRole("group", { name: "Platform" })).toBeNull();
    expect(screen.queryByText("MindHub & sources")).toBeNull();
    unmount();

    mockAuth = { isAuthenticated: true, role: "admin", isPlatformAdmin: true };
    render(
      <MemoryRouter>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    const settings = screen.getByRole("group", { name: "Platform" });
    expect(
      within(settings).getByText("MindHub & sources").closest("a")?.getAttribute("href"),
    ).toBe("/platform/sources");
  });

  /** Every sidebar link that carries aria-current, as label → value. */
  function currentRows(): Record<string, string | null> {
    const nav = screen.getByRole("navigation", { name: "Main" });
    return Object.fromEntries(
      within(nav)
        .getAllByRole("link")
        .filter((a) => a.hasAttribute("aria-current"))
        .map((a) => [a.textContent, a.getAttribute("aria-current")]),
    );
  }

  it("marks a plain entry on its own route as the current page", () => {
    render(
      <MemoryRouter initialEntries={["/rag/pipelines"]}>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    expect(currentRows()).toEqual({ Assistants: "page" });
  });

  it("marks a tabbed entry as the current section, not the page (the tab is the page)", () => {
    for (const path of ["/marketplace/installed/ai-tools", "/marketplace/installed/plugins", "/rag/conversations"]) {
      const { unmount } = render(
        <MemoryRouter initialEntries={[path]}>
          <Sidebar open={false} onNavigate={() => {}} />
        </MemoryRouter>,
      );
      expect(currentRows()).toEqual(path === "/rag/conversations" ? { Chat: "true" } : { Discover: "true" });
      unmount();
    }
  });

  it("marks an entry 'page' when the caller sees no tab strip for it", () => {
    // Security has one tab (Audit log), so no tab strip renders and the
    // sidebar row is the only current-page marker.
    mockAuth = { isAuthenticated: true, role: "user", orgRole: "admin" };
    render(
      <MemoryRouter initialEntries={["/organization/security/audit"]}>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    expect(currentRows()).toEqual({ Security: "page" });
  });

  it("marks MindHub & sources 'page' on the list and 'true' on a repository's detail", () => {
    mockAuth = { isAuthenticated: true, role: "admin", isPlatformAdmin: true };
    const { unmount } = render(
      <MemoryRouter initialEntries={["/platform/sources"]}>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    expect(currentRows()).toEqual({ "MindHub & sources": "page" });
    unmount();
    render(
      <MemoryRouter initialEntries={["/platform/sources/r1"]}>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    expect(currentRows()).toEqual({ "MindHub & sources": "true" });
  });


  it("shows All Users to the operator only, and the org Users page to org owners/admins", () => {
    const first = render(
      <MemoryRouter>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByText("All users")).toBeNull();
    expect(screen.queryByText("People", { selector: "a *, a" })).toBeNull();
    first.unmount();

    mockAuth = { isAuthenticated: true, role: "user", orgRole: "admin" };
    const { unmount } = render(
      <MemoryRouter>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByText("All users")).toBeNull();
    expect(
      screen.getByText("People", { selector: "a *, a" }).closest("a")?.getAttribute("href"),
    ).toBe("/organization/people");
    unmount();

    // Operator screens gate on the Platform Admin claim only: the instance
    // "admin" role without it (an org owner, an SSO admin) is not an operator.
    mockAuth = { isAuthenticated: true, role: "admin", isPlatformAdmin: false };
    const third = render(
      <MemoryRouter>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByText("All users")).toBeNull();
    expect(screen.queryByRole("group", { name: "Platform" })).toBeNull();
    third.unmount();

    mockAuth = { isAuthenticated: true, role: "admin", isPlatformAdmin: true };
    render(
      <MemoryRouter>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    expect(
      screen.getByText("All users").closest("a")?.getAttribute("href"),
    ).toBe("/platform/users");
  });
});

describe("Sidebar: pending requests badge", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function stubApi(pending: number) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const body = String(input).includes("/v1/access-requests/inbox")
        ? { requests: [], total: pending, limit: 50, offset: 0 }
        : { organizations: [], active_organization_id: null };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("counts the requests waiting for an org admin on the People entry (its inbox)", async () => {
    stubApi(3);
    mockAuth = { isAuthenticated: true, role: "user", orgRole: "admin", token: "tok", sessionKey: "s1" };
    render(
      <MemoryRouter>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    const link = await screen.findByRole("link", {
      name: "People 3 requests waiting for your decision",
    });
    expect(link.getAttribute("href")).toBe("/organization/people");
  });

  it("counts a team admin's join requests on My account (My requests holds them)", async () => {
    resetServerPermissionsCache();
    mockAuth = { ...SERVER_SESSION, role: "user", orgRole: "member", token: "tok" };
    const teamAdmin = myPermissions({ orgRole: "member", teams: [{ id: 4, keys: ["team.members.manage"] }] });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const body = url.includes("/v1/me/permissions")
          ? teamAdmin
          : url.includes("/v1/access-requests/inbox")
            ? { requests: [], total: 2, limit: 50, offset: 0 }
            : { organizations: [], active_organization_id: null };
        return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
      }),
    );
    render(
      <MemoryRouter>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    const link = await screen.findByRole("link", {
      name: "My account 2 requests waiting for your decision",
    });
    expect(link.getAttribute("href")).toBe("/account");
  });

  it("never asks for a member who decides nothing", async () => {
    const fetchMock = stubApi(3);
    mockAuth = { isAuthenticated: true, role: "user", orgRole: "member", token: "tok", sessionKey: "s1" };
    render(
      <MemoryRouter>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "My account" })).toBeTruthy();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("access-requests"))).toBe(false);
  });
});
