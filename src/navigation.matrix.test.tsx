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
import { OTHER_TEAM, appLocation, renderApp, resetApp, settleApp } from "./test/renderApp";

/** Each case renders the whole app; the slowest takes about 2 s. */
const APP_TEST = { timeout: 10_000 };
/** How long to wait for async state (the billing probe, a page's fetch). */
const SETTLE = { timeout: 5_000 };

/** A section without a heading (none today: every section is labelled). */
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

/** The nav model nav.ts itself produces for this persona's permissions. */
function modelFromNavTs(persona: Persona): NavModel {
  const model: NavModel = {};
  for (const section of visibleSections(NAV_SECTIONS, personaAccess(persona))) {
    model[section.label ?? TOP] = section.items.map((item) => item.label);
  }
  return model;
}

// --- Expected sidebar per persona --------------------------------------------

/** What every signed-in member sees: Use / Build / Me (client#126 menu
 * decision). There is still no team-role dimension: team_role is not in the
 * token. */
const MEMBER_NAV: NavModel = {
  Use: ["Home", "Chat"],
  Build: ["Knowledge", "Assistants", "Discover"],
  // My team is every member's: their team, or where they ask to join one.
  Me: ["My team", "My account"],
};

/** An org owner or admin: the member nav plus the Organization area.
 * CLOSED (#131): they used to get exactly the member nav, with Public Chat
 * hidden although its page lets them manage endpoints. */
const ORG_ADMIN_NAV: NavModel = {
  ...MEMBER_NAV,
  Organization: [
    "Overview",
    "People",
    "Teams",
    "AI",
    "Plugins",
    "Website chatbots",
    "Knowledge quality",
    "Security",
    "Plan & billing",
  ],
};

const PLATFORM_ADMIN_NAV: NavModel = {
  ...MEMBER_NAV,
  Organization: ORG_ADMIN_NAV.Organization,
  Platform: [
    "Status & logs",
    "Local models",
    "Modules",
    "All organizations",
    "All users",
    "MindHub & sources",
    "Backups",
    "Platform audit log",
  ],
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

  it.each(["teamMember", "orgOwner"] as const)("shows %s the My account tabs", (id) => {
    renderApp(PERSONAS[id], ROUTES.voice);
    const tabs = screen.getByRole("navigation", { name: "My account sections" });
    expect(within(tabs).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Profile",
      "Voice",
      "My requests",
    ]);
  });

  // Organization › People (UX step 7): Members, Invites and the plan tab
  // Domains, which keeps its place on every plan and wears a Pro badge on a
  // plan without it (Q6.3).
  it.each(["orgOwner", "orgAdmin", "platformAdmin"] as const)(
    "shows %s the People tabs, Domains badged on the free plan",
    async (id) => {
      renderApp(PERSONAS[id], ROUTES.people);
      expect(await screen.findByRole("heading", { level: 1, name: "Members" }, SETTLE)).toBeTruthy();
      const tabs = screen.getByRole("navigation", { name: "People sections" });
      await within(tabs).findByText("Available on the Pro plan", {}, SETTLE);
      expect(within(tabs).getAllByRole("link").map((a) => a.textContent)).toEqual([
        "Members",
        "Invites",
        "Requests",
        "DomainsProAvailable on the Pro plan",
      ]);
    },
  );

  it.each(tierVariants("orgOwner").map((p) => [p.tier, p] as const))(
    "keeps the Domains tab on the %s plan, badged only without the feature",
    async (tier, persona) => {
      renderApp(persona, ROUTES.peopleDomains);
      await settleApp();
      const tabs = screen.getByRole("navigation", { name: "People sections" });
      const domains = within(tabs).getByRole("link", { name: /Domains/ });
      expect(!!within(domains).queryByText("Available on the Pro plan")).toBe(tier === "community");
    },
  );

  // Personal licenses were removed (menu decision): the old URL lands on
  // Organization › Plan & billing, where entitlements are shown.
  it("sends the old Licenses URL to Plan & billing, keeping query and hash", async () => {
    renderApp(PERSONAS.orgOwner, "/billing/licenses?tier=pro#keys");
    await settleApp();
    expect(appLocation()?.pathname).toBe(ROUTES.billing);
    expect(appLocation()?.search).toBe("?tier=pro");
    expect(appLocation()?.hash).toBe("#keys");
  });
});

describe("the old /requests URL per persona", APP_TEST, () => {
  afterEach(resetApp);

  it.each([
    ["orgAdmin", ROUTES.requests],
    ["platformAdmin", ROUTES.requests],
    ["teamAdmin", ROUTES.myRequests],
    ["teamMember", ROUTES.myRequests],
  ] as const)("sends %s to %s, keeping query and hash", async (id, target) => {
    renderApp(PERSONAS[id], "/requests?kind=plugin_install#pending");
    await settleApp();
    expect(appLocation()?.pathname).toBe(target);
    expect(appLocation()?.search).toBe("?kind=plugin_install");
    expect(appLocation()?.hash).toBe("#pending");
  });
});

describe("team role: My team and Organization › Teams per persona", APP_TEST, () => {
  afterEach(resetApp);

  /** Expand a team card and wait for its member list to load. */
  async function openTeam(name: string) {
    const details = (await screen.findByText(name, {}, SETTLE)).closest("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    await waitFor(() => expect(within(details).queryByText("Loading…")).toBeNull(), SETTLE);
    return details;
  }

  it.each([
    ["teamAdmin", true],
    ["teamMember", false],
  ] as const)("%s sees only its own team on My team; may manage it: %s", async (id, canManage) => {
    renderApp(PERSONAS[id], ROUTES.myTeam);
    expect(await screen.findByRole("heading", { level: 1, name: "My team" }, SETTLE)).toBeTruthy();
    const details = await openTeam("Engineering");
    await within(details).findAllByText(new RegExp(PERSONAS[id].claims!.username), {}, SETTLE);
    if (canManage) {
      // The controls appear once GET /v1/teams/{id} has answered.
      expect(await screen.findByRole("button", { name: "Add Member" }, SETTLE)).toBeTruthy();
    }
    // Then let every request (a team admin's invites too) answer: the page
    // must still be there, and a member must still have no controls.
    await settleApp();
    expect(screen.getByText("Engineering")).toBeTruthy();
    expect(!!screen.queryByRole("button", { name: "Add Member" })).toBe(canManage);
    // The org's other team is not "my team", and there is no join view.
    expect(screen.queryByText(OTHER_TEAM.name)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Ask to join/ })).toBeNull();
    // A member is not pointed at the org's team administration.
    expect(screen.queryByRole("link", { name: "Open Teams" })).toBeNull();
  });

  it("offers a team-less member the org's teams to ask to join", async () => {
    renderApp(PERSONAS.teamlessMember, ROUTES.myTeam);
    expect(await screen.findByText(/You're not in a team yet. Ask to join/, {}, SETTLE)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Teams" })).toBeTruthy();
    expect(screen.getByText(OTHER_TEAM.name)).toBeTruthy();
    expect(screen.getByRole("button", { name: `Ask to join: ${OTHER_TEAM.name}` })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open Teams" })).toBeNull();
  });

  it.each(["orgOwner", "orgAdmin", "platformAdmin"] as const)(
    "points %s (in no team) at Organization › Teams from My team",
    async (id) => {
      renderApp(PERSONAS[id], ROUTES.myTeam);
      expect(await screen.findByText(/Add yourself to one under Organization › Teams/, {}, SETTLE)).toBeTruthy();
      expect(screen.getByRole("link", { name: "Open Teams" }).getAttribute("href")).toBe(ROUTES.orgTeams);
      expect(screen.queryByRole("button", { name: /^Ask to join/ })).toBeNull();
    },
  );

  // CLOSED: org owners/admins used to get a read-only team unless they were
  // its team_admin. Organization › Teams lists every team, managed under
  // org.teams.manage (as the API's team gate allows).
  it.each(["orgOwner", "orgAdmin"] as const)(
    "lets %s manage any team of the org under Organization › Teams",
    async (id) => {
      renderApp(PERSONAS[id], ROUTES.orgTeams);
      expect(await screen.findByRole("heading", { level: 1, name: "Teams" }, SETTLE)).toBeTruthy();
      await openTeam(OTHER_TEAM.name);
      expect(await screen.findByRole("button", { name: "Add Member" }, SETTLE)).toBeTruthy();
      expect(screen.queryByRole("button", { name: /^Ask to join/ })).toBeNull();
    },
  );

  it("redirects the old /platform/teams to My team, keeping query and hash", async () => {
    renderApp(PERSONAS.teamMember, "/platform/teams?team=10#members");
    await settleApp();
    expect(appLocation()?.pathname).toBe(ROUTES.myTeam);
    expect(appLocation()?.search).toBe("?team=10");
    expect(appLocation()?.hash).toBe("#members");
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

const ORG_ADMINS: PersonaId[] = ["platformAdmin", "orgOwner", "orgAdmin"];
const SIGNED_IN: PersonaId[] = [...ORG_ADMINS, "teamAdmin", "teamMember", "teamlessMember"];

const GATED_ROUTES: GatedRoute[] = [
  { path: ROUTES.chatbots, heading: "Website chatbots", open: ORG_ADMINS },
  { path: ROUTES.backups, heading: "Backups", open: ["platformAdmin"] },
  { path: ROUTES.allOrganizations, heading: "All Organizations", open: ["platformAdmin"] },
  // Organization › Security › Audit log keeps the old /audit gate; the
  // installation-wide log is the Platform Admin's.
  { path: ROUTES.orgAudit, heading: "Audit log", open: ORG_ADMINS },
  { path: ROUTES.platformAudit, heading: "Platform audit log", open: ["platformAdmin"] },
  { path: ROUTES.allUsers, heading: "All users", open: ["platformAdmin"] },
  // Organization › People is for org admins (ux-design §5); members get no
  // people directory (the design's member menu has none).
  { path: ROUTES.people, heading: "Members", open: ORG_ADMINS },
  { path: ROUTES.peopleInvites, heading: "Invites", open: ORG_ADMINS },
  { path: ROUTES.peopleDomains, heading: "Email domains", open: ORG_ADMINS },
  // The requests inbox (People › Requests) and each member's own requests.
  { path: ROUTES.requests, heading: "Requests", open: ORG_ADMINS },
  { path: ROUTES.myRequests, heading: "My requests", open: SIGNED_IN },
  { path: ROUTES.sources, heading: "MindHub & sources", open: ["platformAdmin"] },
  // Organization › AI and › Plugins (UX step 9, Q2/Q3): org admins only;
  // members keep the read-only Models and Installed pages.
  { path: ROUTES.orgAi, heading: "AI providers", open: ORG_ADMINS },
  { path: ROUTES.orgAiDefaults, heading: "Model defaults", open: ORG_ADMINS },
  { path: ROUTES.orgPlugins, heading: "Organization plugins", open: ORG_ADMINS },
  // Organization › Teams: org.teams.manage (team admins manage their own team
  // from My team). My team itself is every member's.
  { path: ROUTES.orgTeams, heading: "Teams", open: ORG_ADMINS },
  { path: ROUTES.myTeam, heading: "My team", open: SIGNED_IN },
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
    renderApp(PERSONAS.teamMember, ROUTES.backups);
    await settleApp();
    const request = screen.getByRole("button", { name: "Request access" }) as HTMLButtonElement;
    expect(request.disabled).toBe(true);
    expect(screen.getByText(/This page is open to platform admins/)).toBeTruthy();
  });

  it("sends a signed-out visitor to sign in, remembering the page", async () => {
    renderApp(PERSONAS.loggedOut, ROUTES.orgAudit);
    await settleApp();
    fireEvent.click(within(screen.getByRole("main")).getByRole("link", { name: "Log in" }));
    expect(appLocation()?.pathname).toBe("/login");
    expect(appLocation()?.state).toEqual({ from: ROUTES.orgAudit });
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
      expect(navShows(PERSONAS[id], ROUTES.chatbots)).toBe(true);
      const { fetchMock } = renderApp(PERSONAS[id], ROUTES.chatbots);
      await settleApp();
      expect(screen.queryByText(/to manage website chatbots/)).toBeNull();
      await waitFor(() =>
        expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/v1/public-chat/endpoints"))).toBe(
          true,
        ),
        SETTLE,
      );
    },
  );

  // CLOSED: a Platform Admin whose token carries role "user" used to pass the
  // guard and then be locked out by the page body, which checked
  // `role === "admin"`. The operator pages read the claim now.
  it("a Platform Admin without the instance admin role gets the operator nav and pages", async () => {
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
    expect(screen.queryByText(/Only a Platform Admin can see this installation/)).toBeNull();
  });

  // CLOSED: the instance role "admin" without the claim (an org owner, an SSO
  // admin) used to count as the operator here, though the operator APIs
  // refuse it. Now it gets neither the entries nor the pages.
  it.each([ROUTES.allUsers, ROUTES.backups, ROUTES.sources, ROUTES.platformAudit])(
    "an instance admin without the Platform Admin claim gets no nav entry and no page for %s",
    async (path) => {
      const persona = withPersona("orgOwner", { label: "instance admin, no claim", claims: { role: "admin" } });
      expect(navShows(persona, path)).toBe(false);
      renderApp(persona, path);
      await settleApp();
      expect(screen.getByRole("heading", { level: 1, name: "You don't have access to this page" })).toBeTruthy();
    },
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

// A custom role holding org.settings.manage without org.members.manage: the
// requests inbox is theirs (People › Requests) although Members and Invites
// are not, so People must show (gated by its tabs), carry the pending badge,
// and be where the old /requests lands. Its keys come only from the server,
// so this also covers acting before GET /v1/me/permissions has answered.
describe("a custom role with the inbox but not the member list", APP_TEST, () => {
  afterEach(resetApp);

  const settingsOnly = withPersona("teamlessMember", {
    label: "custom role: org.settings.manage only",
    claims: { org_role: "settings_admin" },
    orgKeys: ["org.settings.manage"],
    pendingRequests: 2,
  });

  it("gets People (Requests, Domains) in the menu, with the pending badge", async () => {
    renderApp(settingsOnly);
    await settleApp();
    await waitFor(
      () =>
        expect(renderedNav()).toEqual({
          ...MEMBER_NAV,
          // The badge: "2" on screen, "2 requests …" for screen readers.
          Organization: ["Overview", "People22 requests waiting for your decision", "Plugins", "Knowledge quality"],
        }),
      SETTLE,
    );
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: /^People/ }).getAttribute("href")).toBe(ROUTES.requests);
  });

  it("opens the inbox, with Requests and Domains as the People tabs", async () => {
    renderApp(settingsOnly, ROUTES.requests);
    expect(await screen.findByRole("heading", { level: 1, name: "Requests" }, SETTLE)).toBeTruthy();
    await settleApp();
    const tabs = screen.getByRole("navigation", { name: "People sections" });
    expect(within(tabs).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Requests",
      "DomainsProAvailable on the Pro plan",
    ]);
  });

  it("is sent from the old /requests to the inbox once its permissions arrive", async () => {
    renderApp(settingsOnly, "/requests?kind=plugin_install#pending");
    await settleApp();
    expect(appLocation()?.pathname).toBe(ROUTES.requests);
    expect(appLocation()?.search).toBe("?kind=plugin_install");
    expect(appLocation()?.hash).toBe("#pending");
  });
});

describe("persona fixtures", () => {
  it("refuses claim overrides for the logged-out visitor", () => {
    expect(() => withPersona("loggedOut", { claims: { role: "admin" } })).toThrow(/no token/);
    expect(withPersona("loggedOut", { tier: PERSONAS.orgOwner.tier }).claims).toBeNull();
  });
});
