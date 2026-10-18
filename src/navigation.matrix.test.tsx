/**
 * Role/persona matrix for the navigation and route access (client#126).
 *
 * A safety net for the information-architecture rewrite: every expectation
 * below is what the app does now, spelled out explicitly (no snapshots) so a
 * change to who-sees-what fails a test and has to be made on purpose. Rows
 * that still look wrong carry a `// KNOWN GAP (client#126)` comment.
 *
 * #131 moved the shell to the new IA and to one gate, useCan: the sidebar
 * tables, the route guards and four of the gaps changed deliberately (each is
 * marked `CLOSED (#131)` where it used to be pinned).
 *
 * Personas: src/test/personas.ts. Rendering: src/test/renderApp.tsx (the real
 * App shell, with the API faked at `fetch`).
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NAV_SECTIONS, visibleEntry, visibleSections } from "./lib/nav";
import { ROUTES } from "./lib/routes";
import {
  PERSONAS,
  PERSONA_IDS,
  type Persona,
  type PersonaId,
  personaAccess,
  tierVariants,
  withPersona,
} from "./test/personas";
import { appLocation, renderApp, resetApp, settleApp } from "./test/renderApp";

/** Each case renders the whole app; the slowest takes about 2 s. */
const APP_TEST = { timeout: 10_000 };
/** How long to wait for async state (the billing probe, a page's fetch). */
const SETTLE = { timeout: 5_000 };

/** The heading-less top group (Home, Ask). */
const TOP = "(top)";

type NavModel = Record<string, string[]>;

/** The sidebar as rendered: section label → its visible entry labels. */
function renderedNav(): NavModel {
  const nav = screen.getByRole("navigation", { name: "Main" });
  const model: NavModel = {};
  for (const link of within(nav).queryAllByRole("link")) {
    const group = link.closest('[role="group"]');
    const labelId = group?.getAttribute("aria-labelledby");
    const section = labelId ? (document.getElementById(labelId)?.textContent ?? "?") : TOP;
    (model[section] ??= []).push(link.textContent ?? "");
  }
  return model;
}

/** The href of a rendered sidebar entry. */
function navHref(label: string): string | null {
  const nav = screen.getByRole("navigation", { name: "Main" });
  return within(nav).getByRole("link", { name: label }).getAttribute("href");
}

/** The nav model nav.ts itself produces for this persona's permissions. */
function modelFromNavTs(persona: Persona): NavModel {
  const model: NavModel = {};
  for (const section of visibleSections(NAV_SECTIONS, personaAccess(persona))) {
    model[section.label ?? TOP] = section.items.map((item) => item.label);
  }
  return model;
}

// --- Expected sidebar per persona --------------------------------------------

/** What every signed-in member sees: the sections everyone works in. There is
 * still no team-role dimension: team_role is not in the token. */
const MEMBER_NAV: NavModel = {
  [TOP]: ["Home", "Ask"],
  Knowledge: ["Knowledge Bases", "Pipelines", "Conversations", "Knowledge Graph"],
  Marketplace: ["Discover", "Installed", "Publish"],
  "AI & system": ["Models", "Status"],
  Team: ["Teams"],
  "My account": ["Profile & settings", "Voice", "Licenses"],
};

/** An org owner or admin: the member nav plus the Organization section.
 * CLOSED (#131): they used to get exactly the member nav, with Public Chat
 * hidden although its page lets them manage endpoints. */
const ORG_ADMIN_NAV: NavModel = {
  ...MEMBER_NAV,
  Organization: ["Overview", "Users", "Public Chat", "Providers & defaults", "Billing"],
};

const PLATFORM_ADMIN_NAV: NavModel = {
  ...MEMBER_NAV,
  Organization: [...ORG_ADMIN_NAV.Organization, "Audit Log"],
  Platform: ["All Organizations", "All Users", "Backups", "MindHub & sources"],
};

const EXPECTED_NAV: Record<PersonaId, NavModel> = {
  platformAdmin: PLATFORM_ADMIN_NAV,
  orgOwner: ORG_ADMIN_NAV,
  orgAdmin: ORG_ADMIN_NAV,
  teamAdmin: MEMBER_NAV,
  teamMember: MEMBER_NAV,
  teamlessMember: MEMBER_NAV,
  // CLOSED (#131): a logged-out visitor used to see the whole app nav, with
  // Billing reading as allowed. Signed out, useCan allows nothing.
  loggedOut: {},
};

describe("navigation matrix: sidebar per persona", APP_TEST, () => {
  afterEach(resetApp);

  it("covers every persona", () => {
    expect(Object.keys(EXPECTED_NAV).sort()).toEqual([...PERSONA_IDS].sort());
  });

  it.each(PERSONA_IDS)("the expected table for %s matches nav.ts's own gating", (id) => {
    expect(modelFromNavTs(PERSONAS[id])).toEqual(EXPECTED_NAV[id]);
  });

  it.each(PERSONA_IDS)("renders the expected sidebar for %s", async (id) => {
    renderApp(PERSONAS[id]);
    // Billing visibility settles after the subscription probe answers.
    await settleApp();
    await waitFor(() => expect(renderedNav()).toEqual(EXPECTED_NAV[id]), SETTLE);
  });

  it.each(tierVariants("orgOwner").map((p) => [p.tier, p] as const))(
    "does not change the sidebar by plan tier (%s)",
    async (_tier, persona) => {
      renderApp(persona);
      await settleApp();
      expect(renderedNav()).toEqual(ORG_ADMIN_NAV);
    },
  );

  it("draws the administration sections below the rest", () => {
    const labels = Object.keys(PLATFORM_ADMIN_NAV);
    expect(labels.slice(-2)).toEqual(["Organization", "Platform"]);
  });
});

describe("navigation matrix: in-page tab strips", APP_TEST, () => {
  afterEach(resetApp);

  it("shows the Publish tabs (with Submission review) to a platform admin", () => {
    renderApp(PERSONAS.platformAdmin, ROUTES.publishSubmissions);
    const tabs = screen.getByRole("navigation", { name: "Publish sections" });
    expect(within(tabs).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Submissions",
      "Submission review",
    ]);
  });

  it.each(["orgOwner", "orgAdmin", "teamlessMember"] as const)(
    "shows %s no Publish tab strip (Submission review is instance-admin only)",
    async (id) => {
      renderApp(PERSONAS[id], ROUTES.publishSubmissions);
      expect(screen.getByRole("heading", { level: 1, name: "Plugin submissions" })).toBeTruthy();
      await settleApp();
      expect(screen.queryByRole("navigation", { name: "Publish sections" })).toBeNull();
    },
  );

  // Billing (Organization) and Licenses (My account) are separate entries
  // since #131, so neither page carries a tab strip.
  it.each(["orgOwner", "teamMember"] as const)("Licenses has no tab strip for %s", async (id) => {
    renderApp(PERSONAS[id], ROUTES.licenses);
    await settleApp();
    expect(navHref("Licenses")).toBe(ROUTES.licenses);
    expect(screen.queryByRole("navigation", { name: /sections$/ })).toBeNull();
  });
});

describe("team role: Teams page controls per persona", APP_TEST, () => {
  afterEach(resetApp);

  /** Expand a team card and wait for its member list (the caller's row). */
  async function openTeam(name: string, persona: Persona) {
    const details = (await screen.findByText(name, {}, SETTLE)).closest("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    await within(details).findAllByText(new RegExp(persona.claims!.username), {}, SETTLE);
  }

  it.each([
    ["teamAdmin", true],
    ["teamMember", false],
  ] as const)("%s may manage its team: %s", async (id, canManage) => {
    renderApp(PERSONAS[id], "/platform/teams");
    await openTeam("Engineering", PERSONAS[id]);
    if (canManage) {
      // The controls appear once GET /v1/teams/{id} has answered.
      expect(await screen.findByRole("button", { name: "Add Member" }, SETTLE)).toBeTruthy();
    }
    // Then let every request (a team admin's invites too) answer: the page
    // must still be there, and a member must still have no controls.
    await settleApp();
    expect(screen.getByText("Engineering")).toBeTruthy();
    expect(!!screen.queryByRole("button", { name: "Add Member" })).toBe(canManage);
  });

  it("shows a team-less member no teams", async () => {
    renderApp(PERSONAS.teamlessMember, "/platform/teams");
    expect(await screen.findByText(/No teams yet/, {}, SETTLE)).toBeTruthy();
  });
});

// --- Route access per persona ------------------------------------------------
//
// Since #131 the router guards these routes with useCan: a caller without the
// permission gets the forbidden page at the same URL (a signed-out visitor is
// asked to sign in), and the page itself never renders. Each guard asks what
// the page already checked, so who gets in is unchanged; only the locked
// view moved from the page's own callout to the shell.

interface GatedRoute {
  path: string;
  heading: string;
  /** Personas that get the page. Everyone else gets the forbidden page. */
  open: PersonaId[];
}

const GATED_ROUTES: GatedRoute[] = [
  { path: "/rag/public-chat", heading: "Public Chat", open: ["platformAdmin", "orgOwner", "orgAdmin"] },
  { path: "/platform/backups", heading: "Backups", open: ["platformAdmin"] },
  { path: "/organizations", heading: "All Organizations", open: ["platformAdmin"] },
  { path: "/audit", heading: "Audit Log", open: ["platformAdmin"] },
  { path: ROUTES.publishSubmissionReview, heading: "Submission review", open: ["platformAdmin"] },
  { path: "/platform/users", heading: "All users", open: ["platformAdmin"] },
  { path: ROUTES.sources, heading: "MindHub & sources", open: ["platformAdmin"] },
];

const ROUTE_CASES = GATED_ROUTES.flatMap((route) =>
  PERSONA_IDS.map((id) => [route.path, id, route.open.includes(id) ? "open" : "locked", route] as const),
);

/** The heading the guard shows a locked-out persona. */
function lockedHeading(id: PersonaId): string {
  return id === "loggedOut" ? "Sign in to continue" : "You don't have access to this page";
}

describe("route access matrix: route guards per persona", APP_TEST, () => {
  afterEach(resetApp);

  it.each(ROUTE_CASES)("%s as %s is %s", async (path, id, access, route) => {
    renderApp(PERSONAS[id], path);
    await settleApp();
    // The guard never redirects: the URL stays, so a later sign-in or grant
    // lands on the page itself.
    expect(appLocation()?.pathname).toBe(path);
    const expected = access === "open" ? route.heading : lockedHeading(id);
    expect(screen.getByRole("heading", { level: 1, name: expected })).toBeTruthy();
    if (access === "locked") {
      expect(screen.queryByRole("heading", { level: 1, name: route.heading })).toBeNull();
    }
  });

  it("offers a disabled Request access action until access requests exist", async () => {
    renderApp(PERSONAS.teamMember, "/platform/backups");
    await settleApp();
    const request = screen.getByRole("button", { name: "Request access" }) as HTMLButtonElement;
    expect(request.disabled).toBe(true);
    expect(screen.getByText(/This page is open to platform admins/)).toBeTruthy();
  });

  it("sends a signed-out visitor to sign in, remembering the page", async () => {
    renderApp(PERSONAS.loggedOut, "/audit");
    await settleApp();
    fireEvent.click(within(screen.getByRole("main")).getByRole("link", { name: "Log in" }));
    expect(appLocation()?.pathname).toBe("/login");
    expect(appLocation()?.state).toEqual({ from: "/audit" });
  });
});

// --- Known gaps --------------------------------------------------------------

/** Is the route's sidebar entry (or tab) visible to the persona per nav.ts? */
function navShows(persona: Persona, path: string): boolean {
  const can = personaAccess(persona);
  return NAV_SECTIONS.some((s) =>
    s.items.some((item) => {
      const entry = visibleEntry(item, can);
      return !!entry && (entry.to === path || !!entry.tabs?.some((t) => t.to === path));
    }),
  );
}

describe("known gaps (client#126)", APP_TEST, () => {
  afterEach(resetApp);

  // CLOSED (#131): Backups used to be in every member's sidebar while its
  // page locked them out. It is in Platform now, for operators only.
  it.each(PERSONA_IDS.filter((id) => id !== "platformAdmin"))(
    "Backups is neither in the nav nor open for %s",
    async (id) => {
      expect(navShows(PERSONAS[id], "/platform/backups")).toBe(false);
      renderApp(PERSONAS[id], "/platform/backups");
      await settleApp();
      expect(screen.getByRole("heading", { level: 1, name: lockedHeading(id) })).toBeTruthy();
    },
  );

  // CLOSED (#131): Public Chat used to be hidden from org owners/admins
  // although the page (and the backend) let them manage endpoints.
  it.each(["orgOwner", "orgAdmin"] as const)(
    "Public Chat is in the nav for %s and the page lets them manage it",
    async (id) => {
      expect(navShows(PERSONAS[id], "/rag/public-chat")).toBe(true);
      const { fetchMock } = renderApp(PERSONAS[id], "/rag/public-chat");
      await settleApp();
      expect(screen.queryByText(/to manage public chat endpoints/)).toBeNull();
      await waitFor(() =>
        expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/v1/public-chat/endpoints"))).toBe(
          true,
        ),
        SETTLE,
      );
    },
  );

  // KNOWN GAP (client#126), narrowed by #131: the shell now treats the
  // Platform Admin claim as an operator, so a Platform Admin whose token
  // carries role "user" gets the full operator nav and passes the route
  // guards. But the operator page bodies still check the legacy instance role
  // (`role === "admin"`), so MindHub & sources -- whose copy says "Only a
  // Platform Admin" -- still locks them out from inside the page.
  it("a Platform Admin without the legacy admin role passes the guard but the page body locks", async () => {
    const persona = withPersona("orgOwner", {
      label: "platform admin, role user",
      claims: { is_platform_admin: true },
    });
    renderApp(persona);
    await settleApp();
    expect(renderedNav()).toEqual(PLATFORM_ADMIN_NAV);
    resetApp();
    renderApp(persona, ROUTES.sources);
    expect(screen.getByRole("heading", { level: 1, name: "MindHub & sources" })).toBeTruthy();
    expect(screen.getByText(/Only a Platform Admin can see this installation/)).toBeTruthy();
  });

  // KNOWN GAP (client#126), new with #131: operator screens gate on the
  // Platform Admin, which the role-backed permissions take as the claim OR the
  // legacy instance role "admin" (the operator APIs accept either). The All
  // users page body still wants the claim, so a legacy admin without it sees
  // the entry and passes the guard, then the page locks them out.
  it("a legacy instance admin without the Platform Admin claim is locked out of All users by the page", async () => {
    const persona = withPersona("orgOwner", { label: "legacy admin, no claim", claims: { role: "admin" } });
    expect(navShows(persona, "/platform/users")).toBe(true);
    renderApp(persona, "/platform/users");
    await settleApp();
    expect(screen.getByRole("heading", { level: 1, name: "All users" })).toBeTruthy();
    expect(screen.getByText(/Only a Platform Admin can view every account/)).toBeTruthy();
  });

  it.todo(
    // KNOWN GAP (client#126): TeamsPage lets only an instance admin or the
    // team's own team_admin manage a team. An org owner/admin who is not
    // that team's team_admin gets a read-only team, and the nav has no
    // org-level team administration. Decide in the new IA who manages teams.
    "org owners/admins can manage their org's teams",
  );

  it.todo(
    // KNOWN GAP (client#126): Knowledge Graph › Taxonomy Review is in every
    // member's nav and the page has no client-side role gate (the API is the
    // only check). Decide who reviews taxonomy suggestions.
    "Taxonomy Review is shown only to the roles allowed to approve suggestions",
  );

  it.todo(
    // KNOWN GAP (client#126): no persona-specific landing. Every persona,
    // including a logged-out visitor, lands on the same Home dashboard.
    "each persona lands on its own default page",
  );
});

describe("persona fixtures", () => {
  it("refuses claim overrides for the logged-out visitor", () => {
    expect(() => withPersona("loggedOut", { claims: { role: "admin" } })).toThrow(/no token/);
    expect(withPersona("loggedOut", { tier: PERSONAS.orgOwner.tier }).claims).toBeNull();
  });
});
