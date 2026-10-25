import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  MemoryRouter,
  useLocation,
  useNavigate,
  type Location,
  type NavigateFunction,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { useConfirm } from "./components/ConfirmDialog";
import { TOKEN_KEY } from "./lib/api";
import { MUST_CHANGE_PASSWORD_KEY } from "./lib/auth";
import { NAV_SECTIONS } from "./lib/nav";
import { LEGACY_REDIRECTS, ROUTES, SECTION_REDIRECTS } from "./lib/routes";

// Every page fetches on mount. A bare `{}` stub trips a real (if low-risk --
// the backend always sends these keys) defensive-coding gap in HealthStrip,
// which does `services.data.length` after `=== null` guard that a resolved
// `undefined` `.services` key slips past -- out of scope here, so instead the
// stub carries every array/count key any mounted page's fetch destructures,
// all zero-length/zero, which every page already renders as a normal empty
// state rather than an error.
vi.mock("./lib/api", async () => {
  const actual = await vi.importActual<typeof import("./lib/api")>("./lib/api");
  const safeEmptyResponse = {
    items: [],
    total: 0,
    limit: 20,
    offset: 0,
    count: 0,
    plugins: [],
    installations: [],
    dependencies: [],
    conflicts: [],
    recommendations: [],
    services: [],
    bundles: [],
    tools: [],
    repositories: [],
    organizations: [],
    licenses: [],
  };
  return { ...actual, apiFetch: vi.fn().mockResolvedValue(safeEmptyResponse) };
});

// The router's current location, captured by a probe rendered next to <App/>.
let currentLocation: Location | null = null;
let currentNavigate: NavigateFunction | null = null;
function LocationProbe() {
  currentLocation = useLocation();
  currentNavigate = useNavigate();
  return null;
}

/** Let two animation frames pass: past the one a focus move would use. */
async function nextFrames() {
  for (let i = 0; i < 2; i++) {
    await act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
  }
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <LocationProbe />
    </MemoryRouter>,
  );
}

/** Sign in (sessionStorage JWT) with the given instance role. */
function signIn(role: string, isPlatformAdmin = false) {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "");
  const now = Math.floor(Date.now() / 1000);
  sessionStorage.setItem(
    TOKEN_KEY,
    `${b64({ alg: "HS256" })}.${b64({ sub: "7", username: "alice", role, is_platform_admin: isPlatformAdmin, iat: now, exp: now + 3600 })}.sig`,
  );
}

describe("App", () => {
  afterEach(() => {
    sessionStorage.clear();
    cleanup();
  });

  it("renders the home dashboard at /", () => {
    renderAt("/");
    expect(screen.getByRole("heading", { name: "Minder" })).toBeTruthy();
  });

  it("renders the login page at /login", () => {
    renderAt("/login");
    expect(screen.getByRole("heading", { name: "Log in" })).toBeTruthy();
  });

  it("opens a reset link in a tab that must change its password (#2138)", () => {
    // A signed-in session flagged must_change_password: the forced-change
    // gate covers the app's routes, but not the public recovery routes.
    const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "");
    const now = Math.floor(Date.now() / 1000);
    sessionStorage.setItem(
      TOKEN_KEY,
      `${b64({ alg: "HS256" })}.${b64({ sub: "7", username: "alice", iat: now, exp: now + 3600 })}.sig`,
    );
    sessionStorage.setItem(MUST_CHANGE_PASSWORD_KEY, "1");
    window.history.replaceState(null, "", "/reset-password#token=gated-tab-token");
    try {
      renderAt("/reset-password");
      expect(screen.getByRole("heading", { name: "Choose a new password" })).toBeTruthy();
      expect(screen.queryByText(/An administrator reset your password/)).toBeNull();
      // The page took the token: it's out of the address bar, and the
      // signed-in user is asked to sign out before resetting.
      expect(window.location.hash).toBe("");
      expect(screen.getByRole("button", { name: "Sign out and continue" })).toBeTruthy();
      cleanup();
      // Every other route is still gated.
      renderAt(ROUTES.account);
      expect(screen.getByText(/An administrator reset your password/)).toBeTruthy();
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("shows the 404 page for an unmatched path, with search and the way home (#131)", () => {
    renderAt("/this-route-does-not-exist");
    expect(currentLocation?.pathname).toBe("/this-route-does-not-exist");
    expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeTruthy();
    expect(screen.getByText(/There is no page at \/this-route-does-not-exist/)).toBeTruthy();
    const main = screen.getByRole("main");
    expect(within(main).getByRole("link", { name: "Back to home" }).getAttribute("href")).toBe("/");
    fireEvent.click(within(main).getByRole("button", { name: "Search pages" }));
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeTruthy();
  });

  it("shows breadcrumbs above a page on the menu, and none on Home (#131)", () => {
    signIn("member");
    renderAt("/rag/taxonomy-review");
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getAllByRole("listitem").map((li) => li.textContent).filter(Boolean)).toEqual([
      "Home",
      "Build",
      "Knowledge",
      "Taxonomy Review",
    ]);
    expect(within(crumbs).getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/");
    expect(within(crumbs).getByRole("link", { name: "Knowledge" }).getAttribute("href")).toBe("/rag");
    expect(within(crumbs).getByText("Taxonomy Review").getAttribute("aria-current")).toBe("page");
    cleanup();
    renderAt("/");
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
  });

  it("redirects the old /marketplace path to Discover plugins", () => {
    renderAt("/marketplace");
    expect(screen.getByRole("heading", { name: "Discover plugins" })).toBeTruthy();
  });

  it("redirects the old /platform/bundles path to Platform › Modules", () => {
    renderAt("/platform/bundles");
    expect(screen.getByRole("heading", { name: "Discover modules" })).toBeTruthy();
  });

  it("redirects the old section-index /ai-tools path to Discover AI tools", () => {
    renderAt("/ai-tools");
    expect(screen.getByRole("heading", { name: "Discover AI tools" })).toBeTruthy();
  });

  it("redirects the old /knowledge-bases path to the RAG section", () => {
    renderAt("/knowledge-bases");
    expect(screen.getByRole("heading", { name: "Knowledge Bases" })).toBeTruthy();
  });

  it("shows the sidebar and a logged-out UserMenu together", () => {
    renderAt("/");
    expect(screen.getByText("Log in").closest("a")?.getAttribute("href")).toBe(
      "/login",
    );
    expect(screen.getAllByText("Minder").length).toBeGreaterThan(0);
  });

  it("opens the mobile sidebar overlay via the hamburger button, and closes it on overlay click", () => {
    const { container } = renderAt("/");

    expect(container.querySelector(".fixed.inset-0.z-30")).toBeNull();

    fireEvent.click(screen.getByLabelText("Toggle navigation"));
    const overlay = container.querySelector(".fixed.inset-0.z-30");
    expect(overlay).not.toBeNull();

    fireEvent.click(overlay!);
    expect(container.querySelector(".fixed.inset-0.z-30")).toBeNull();
  });

  it("closes the mobile sidebar overlay when a nav link is clicked", () => {
    signIn("member");
    const { container } = renderAt("/");

    fireEvent.click(screen.getByLabelText("Toggle navigation"));
    expect(container.querySelector(".fixed.inset-0.z-30")).not.toBeNull();

    const sidebar = container.querySelector("aside")!;
    fireEvent.click(within(sidebar).getByText("Assistants"));
    expect(container.querySelector(".fixed.inset-0.z-30")).toBeNull();
  });
});

// The full old → new map (#2197, then the client#126 menu regroup). Spelled
// out here rather than derived from LEGACY_REDIRECTS, so an accidental edit to
// the table fails a test.
const EXPECTED_REDIRECTS: Record<string, string> = {
  "/knowledge-bases": "/rag",
  "/rag-pipelines": "/rag/pipelines",
  "/plugin-config": "/marketplace/installed/plugins",
  "/marketplace": "/marketplace/discover/plugins",
  "/marketplace/discover": "/marketplace/discover/plugins",
  "/marketplace/installed": "/marketplace/installed/plugins",
  "/organization/security": "/organization/security/audit",
  "/marketplace/plugins": "/marketplace/discover/plugins",
  "/marketplace/plugins/available": "/marketplace/discover/plugins",
  "/marketplace/plugins/installed": "/marketplace/installed/plugins",
  "/marketplace/plugins/ai-tools": "/marketplace/discover/ai-tools",
  "/marketplace/bundles": "/platform/modules",
  "/platform/bundles": "/platform/modules",
  "/plugins": "/marketplace/discover/plugins",
  "/plugins/available": "/marketplace/discover/plugins",
  "/plugins/installed": "/marketplace/installed/plugins",
  "/plugins/config": "/marketplace/installed/plugins",
  "/plugins/ai-tools": "/marketplace/discover/ai-tools",
  "/plugins/submissions": "/marketplace/discover/plugins",
  "/plugins/review": "/marketplace/discover/plugins",
  "/plugins/licenses": "/organization/billing",
  "/plugins/sources": "/platform/sources",
  "/plugins/sources/r1": "/platform/sources/r1",
  "/ai-tools": "/marketplace/discover/ai-tools",
  "/ai-tools/available": "/marketplace/discover/ai-tools",
  "/ai-tools/installed": "/marketplace/installed/ai-tools",
  "/bundles": "/platform/modules",
  "/bundles/available": "/platform/modules",
  "/bundles/installed": "/platform/modules/installed",
  "/organization/users": "/organization/people",
  "/platform/providers": "/organization/ai",
  "/platform/teams": "/team",
  // The menu regroup: every moved page's old URL.
  "/rag/public-chat": "/organization/chatbots",
  "/rag/public-chat/7/conversations": "/organization/chatbots/7/conversations",
  "/rag/public-chat/7/conversations/s1": "/organization/chatbots/7/conversations/s1",
  "/rag/entity-merges": "/organization/knowledge-quality",
  "/billing": "/organization/billing",
  "/billing/licenses": "/organization/billing",
  "/audit": "/organization/security/audit",
  "/organizations": "/platform/organizations",
  "/settings": "/account",
  "/settings/sources": "/platform/sources",
  "/settings/sources/r1": "/platform/sources/r1",
  "/marketplace/discover/service-bundles": "/platform/modules",
  "/marketplace/installed/service-bundles": "/platform/modules/installed",
  "/marketplace/publish": "/marketplace/discover/plugins",
  "/marketplace/publish/submissions": "/marketplace/discover/plugins",
  "/marketplace/publish/submission-review": "/marketplace/discover/plugins",
  "/platform": "/platform/models",
  "/platform/status": "/status",
  "/platform/voice": "/account/voice",
};

describe("App — redirects (#2197)", () => {
  afterEach(() => {
    sessionStorage.clear();
    cleanup();
    currentLocation = null;
  });

  it("covers every entry of the redirect tables", () => {
    const tables = [...SECTION_REDIRECTS, ...LEGACY_REDIRECTS].map((r) =>
      r.from.replace(":repositoryId", "r1").replace(":endpointId", "7").replace(":sessionId", "s1"),
    );
    expect(tables.sort()).toEqual(Object.keys(EXPECTED_REDIRECTS).sort());
  });

  it.each(Object.entries(EXPECTED_REDIRECTS))(
    "redirects %s to %s, keeping the query string and hash",
    (from, to) => {
      signIn("admin", true);
      renderAt(`${from}?source=private&q=crm#top`);
      expect(currentLocation?.pathname).toBe(to);
      expect(currentLocation?.search).toBe("?source=private&q=crm");
      expect(currentLocation?.hash).toBe("#top");
    },
  );

  it.each([
    ["a%2Fb", "a/b"],
    ["a%20b%3Fc%23d", "a b?c#d"],
    ["100%25", "100%"],
    ["%E2%9C%93", "✓"],
  ])(
    "keeps an unusual repository id (%s) encoded across the sources redirect",
    (encoded, decoded) => {
      signIn("admin", true);
      renderAt(`/plugins/sources/${encoded}?q=x`);
      // Same single encoding as sourceRepositoryRoute(): no "/" splitting the
      // segment, no double encoding.
      expect(currentLocation?.pathname).toBe(`/platform/sources/${encodeURIComponent(decoded)}`);
      expect(currentLocation?.search).toBe("?q=x");
    },
  );

  it("lands an old ?source= bookmark on Discover plugins with the filter applied", () => {
    renderAt("/plugins/available?source=first-party");
    expect(currentLocation?.pathname).toBe(ROUTES.discoverPlugins);
    expect(currentLocation?.search).toBe("?source=first-party");
    expect(screen.getByRole("heading", { name: "Discover plugins" })).toBeTruthy();
  });
});

describe("App — page titles match the nav (#2197)", () => {
  afterEach(() => {
    sessionStorage.clear();
    cleanup();
  });

  const titled = NAV_SECTIONS.flatMap((s) => s.items)
    .flatMap((i) => [i, ...(i.tabs ?? [])])
    .filter((l) => l.title)
    .map((l) => [l.to, l.title!] as const);

  /** Routes whose nav entry has no title of its own (the label is the page's
   * name) or that have no nav entry at all. */
  const UNTITLED: string[] = [
    ROUTES.discoverAiTools,
    ROUTES.installedAiTools,
    ROUTES.chatHistory,
    ROUTES.account,
    ROUTES.voice,
    ROUTES.chatbots,
    ROUTES.knowledgeQuality,
    ROUTES.status,
    ROUTES.models,
    ROUTES.allOrganizations,
    ROUTES.allUsers,
    ROUTES.backups,
  ];

  it("checks every titled destination", () => {
    expect(titled.map(([to]) => to).sort()).toEqual(
      Object.values(ROUTES)
        .filter((to) => !UNTITLED.includes(to))
        .sort(),
    );
  });

  it.each(titled)("renders %s with the heading %s", (to, title) => {
    signIn("admin", true);
    renderAt(to);
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeTruthy();
  });

  it("labels each grouped page's tab strip with its tab labels, current tab marked", () => {
    signIn("admin", true);
    renderAt(ROUTES.installedModules);
    const tabs = screen.getByRole("navigation", { name: "Modules sections" });
    const links = within(tabs).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["Discover", "Installed"]);
    expect(links.map((a) => a.getAttribute("aria-current"))).toEqual([null, "page"]);
  });

  it.each([ROUTES.discoverPlugins, ROUTES.installedPlugins, ROUTES.installedModules, ROUTES.myRequests])(
    "marks exactly one link as the current page on %s (the tab; its sidebar entry is 'true')",
    (path) => {
      signIn("admin", true);
      renderAt(path);
      const pages = document.querySelectorAll('a[aria-current="page"]');
      expect(pages).toHaveLength(1);
      expect(pages[0].closest("nav")?.getAttribute("aria-label")).toMatch(/ sections$/);
      const sidebar = screen.getByRole("navigation", { name: "Main" });
      expect(sidebar.querySelectorAll('a[aria-current="true"]')).toHaveLength(1);
    },
  );
});

describe("App — Installation settings › MindHub & sources gating", () => {
  afterEach(() => {
    sessionStorage.clear();
    cleanup();
  });

  it("shows an admin the sources list and the MindHub placeholder, with no fake controls", async () => {
    signIn("admin", true);
    renderAt(ROUTES.sources);
    const panel = screen.getByRole("region", { name: "MindHub connection" });
    expect(within(panel).queryByRole("button")).toBeNull();
    expect(within(panel).queryByRole("textbox")).toBeNull();
    expect(within(panel).queryByRole("link")).toBeNull();
    expect(await screen.findByText(/No plugin source repositories yet/)).toBeTruthy();
  });

  it("shows a non-admin the forbidden page instead of the page (#131 route guard)", () => {
    signIn("member");
    renderAt(ROUTES.sources);
    expect(currentLocation?.pathname).toBe(ROUTES.sources);
    expect(screen.getByRole("heading", { level: 1, name: "You don't have access to this page" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1, name: "MindHub & sources" })).toBeNull();
    expect(screen.queryByRole("region", { name: "MindHub connection" })).toBeNull();
    expect(screen.queryByText(/No plugin source repositories yet/)).toBeNull();
  });

  // The operator APIs want the Platform Admin claim; role "admin" alone (an org
  // owner, an SSO admin) gets the forbidden page, not a page that 403s.
  it.each([ROUTES.sources, ROUTES.platformAudit, ROUTES.backups])(
    "shows an admin without the Platform Admin claim the forbidden page on %s",
    (path) => {
      signIn("admin");
      renderAt(path);
      expect(screen.getByRole("heading", { level: 1, name: "You don't have access to this page" })).toBeTruthy();
    },
  );
});

describe("App — focus after navigation", () => {
  // Signed in: a signed-out visitor has no menu or tab strips to follow.
  beforeEach(() => signIn("member"));
  afterEach(() => {
    sessionStorage.clear();
    cleanup();
  });

  it("moves focus to the new page's heading when a tab is followed", async () => {
    renderAt(ROUTES.discoverPlugins);
    const tabs = screen.getByRole("navigation", { name: "Discover sections" });
    fireEvent.click(within(tabs).getByRole("link", { name: "Installed" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { level: 1, name: "Installed plugins" }),
      ),
    );
  });

  it("leaves focus alone on the first load, including a legacy redirect", async () => {
    renderAt("/plugins/available");
    // Two frames: past the one the focus effect would have used.
    for (let i = 0; i < 2; i++) {
      await act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
    }
    expect(currentLocation?.pathname).toBe(ROUTES.discoverPlugins);
    expect(document.activeElement).toBe(document.body);
  });

  it("does not move focus on a query-only change after a real navigation", async () => {
    renderAt(ROUTES.discoverAiTools);
    // A real navigation first (PUSH), so the first-load case is behind us.
    const tabs = screen.getByRole("navigation", { name: "Discover sections" });
    fireEvent.click(within(tabs).getByRole("link", { name: "Plugins" }));
    const heading = screen.getByRole("heading", { level: 1, name: "Discover plugins" });
    await waitFor(() => expect(document.activeElement).toBe(heading));

    // The source filter rewrites ?source= (a REPLACE)…
    const filter = screen.getByRole("combobox", { name: "Filter by source" });
    filter.focus();
    fireEvent.change(filter, { target: { value: "submitted" } });
    await nextFrames();
    expect(currentLocation?.search).toBe("?source=submitted");
    expect(document.activeElement).toBe(filter);

    // …then a PUSH to the same pathname with a new query (what a palette
    // result on the current page does): the navigation type changes, the
    // pathname doesn't, so focus must stay put.
    act(() => currentNavigate!(`${ROUTES.discoverPlugins}?source=submitted&q=crm`));
    await nextFrames();
    expect(currentLocation?.search).toBe("?source=submitted&q=crm");
    expect(document.activeElement).toBe(filter);
  });

  it("does not move focus when Back returns to the same pathname", async () => {
    renderAt(ROUTES.discoverAiTools);
    const tabs = screen.getByRole("navigation", { name: "Discover sections" });
    fireEvent.click(within(tabs).getByRole("link", { name: "Plugins" }));
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe("Discover plugins"),
    );
    act(() => currentNavigate!(`${ROUTES.discoverPlugins}?q=crm`));
    await nextFrames();
    const filter = screen.getByRole("combobox", { name: "Filter by source" });
    filter.focus();
    act(() => currentNavigate!(-1)); // POP, same pathname, query dropped
    await nextFrames();
    expect(currentLocation?.search).toBe("");
    expect(document.activeElement).toBe(filter);
  });

});

/** A page-level confirm dialog next to the app, as any page's useConfirm. */
function AskButton() {
  const { confirm, dialog } = useConfirm();
  return (
    <>
      {dialog}
      <button onClick={() => confirm({ title: "Delete it?", message: "Really." })}>Ask</button>
    </>
  );
}

function pressCommandK(init: KeyboardEventInit = { metaKey: true }) {
  return fireEvent.keyDown(window, { key: "k", ...init });
}

function palette() {
  return screen.queryByRole("dialog", { name: "Command palette" });
}

describe("App — ⌘K and the modal layer (#97)", () => {
  beforeEach(() => signIn("member"));
  afterEach(() => {
    sessionStorage.clear();
    cleanup();
  });

  it("opens the palette over an inert app and returns focus when ⌘K closes it", () => {
    const { container } = renderAt("/");
    const toggle = screen.getByRole("button", { name: "Toggle navigation" });
    toggle.focus();

    expect(pressCommandK()).toBe(false); // default prevented
    expect(palette()).toBeTruthy();
    expect(container.hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Search pages and actions" }));

    pressCommandK({ ctrlKey: true });
    expect(palette()).toBeNull();
    expect(container.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(toggle);
  });

  it("leaves focus on the new page's heading after a palette selection navigates, never on the trigger", async () => {
    renderAt("/");
    const trigger = screen.getAllByRole("button", { name: "Open command palette" })[0];
    trigger.focus();
    fireEvent.click(trigger);
    const focusedTrigger = vi.fn();
    trigger.addEventListener("focus", focusedTrigger);

    const input = screen.getByRole("combobox", { name: "Search pages and actions" });
    fireEvent.change(input, { target: { value: "installed plugins" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(palette()).toBeNull();
    expect(currentLocation?.pathname).toBe(ROUTES.installedPlugins);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { level: 1, name: "Installed plugins" }),
      ),
    );
    await nextFrames();
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { level: 1, name: "Installed plugins" }),
    );
    expect(focusedTrigger).not.toHaveBeenCalled();
  });

  it("toggles on every ⌘K, however fast they come", () => {
    renderAt("/");
    act(() => {
      pressCommandK();
      pressCommandK();
    });
    expect(palette()).toBeNull();
    act(() => {
      pressCommandK();
      pressCommandK();
      pressCommandK();
    });
    expect(palette()).toBeTruthy();
  });

  it("ignores ⌘K / Ctrl-K while a confirm dialog is open", async () => {
    render(
      <MemoryRouter>
        <App />
        <AskButton />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    const dialog = await screen.findByRole("alertdialog");

    // Still swallowed, so it can't reach the browser's own shortcut.
    expect(pressCommandK()).toBe(false);
    expect(pressCommandK({ ctrlKey: true })).toBe(false);
    expect(palette()).toBeNull();
    expect(screen.getByRole("alertdialog")).toBe(dialog);

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    pressCommandK();
    expect(palette()).toBeTruthy();
  });
});

