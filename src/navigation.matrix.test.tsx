/**
 * Role/persona matrix for TODAY's navigation and route access (client#126).
 *
 * This is a safety net for the information-architecture rewrite, not a spec
 * of the desired behaviour: every expectation below is what the app does now,
 * spelled out explicitly (no snapshots) so a change to who-sees-what fails a
 * test and has to be made on purpose. Rows that look wrong today carry a
 * `// KNOWN GAP (client#126)` comment; flip them when the new IA lands.
 *
 * Personas: src/test/personas.ts. Rendering: src/test/renderApp.tsx (the real
 * App shell, with the API faked at `fetch`).
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NAV_SECTIONS, visibleEntry, type NavEntry } from "./lib/nav";
import { ROUTES } from "./lib/routes";
import {
  PERSONAS,
  PERSONA_IDS,
  type Persona,
  type PersonaId,
  personaNavAccess,
  tierVariants,
  withPersona,
} from "./test/personas";
import { appLocation, renderApp, resetApp } from "./test/renderApp";

/** Each case renders the whole app; on a busy CI host that can take seconds. */
const APP_TEST = { timeout: 30_000 };
/** How long to wait for async state (the billing probe, a page's fetch). */
const SETTLE = { timeout: 10_000 };

/** The heading-less top group (Home, Ask). */
const TOP = "(top)";

type NavModel = Record<string, string[]>;

/** The sidebar as rendered: section label → its visible entry labels. */
function renderedNav(): NavModel {
  const nav = screen.getByRole("navigation", { name: "Main" });
  const model: NavModel = {};
  for (const link of within(nav).getAllByRole("link")) {
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

/** The nav model nav.ts itself produces for this persona's NavAccess. */
function modelFromNavTs(persona: Persona): NavModel {
  const access = personaNavAccess(persona);
  const model: NavModel = {};
  for (const section of NAV_SECTIONS) {
    const items = section.items
      .map((item) => visibleEntry(item, access))
      .filter((item): item is NavEntry => item !== null)
      .map((item) => item.label);
    if (items.length > 0) model[section.label ?? TOP] = items;
  }
  return model;
}

// --- Expected sidebar per persona (today) -----------------------------------

/** What every signed-in non-operator sees. Note there is no org-role
 * dimension at all: the nav never reads `org_role`. */
const MEMBER_NAV: NavModel = {
  [TOP]: ["Home", "Ask"],
  Knowledge: ["Knowledge Bases", "Pipelines", "Conversations", "Knowledge Graph"],
  Marketplace: ["Discover", "Installed", "Publish"],
  Platform: ["Models", "Providers & defaults", "Voice", "Backups", "Status"],
  Organization: ["Overview", "Users", "Billing & licenses", "Teams"],
};

const PLATFORM_ADMIN_NAV: NavModel = {
  [TOP]: ["Home", "Ask"],
  Knowledge: ["Knowledge Bases", "Pipelines", "Conversations", "Public Chat", "Knowledge Graph"],
  Marketplace: ["Discover", "Installed", "Publish"],
  Platform: ["Models", "Providers & defaults", "Voice", "Backups", "Status"],
  Organization: [
    "Overview",
    "Users",
    "Billing & licenses",
    "Teams",
    "All Organizations",
    "All Users",
    "Audit Log",
  ],
  "Installation settings": ["MindHub & sources"],
};

const EXPECTED_NAV: Record<PersonaId, { nav: NavModel; billingHref: string }> = {
  platformAdmin: { nav: PLATFORM_ADMIN_NAV, billingHref: ROUTES.billing },
  // KNOWN GAP (client#126): org owners and org admins get exactly the member
  // nav. Public Chat is hidden from them although PublicChatEndpointsPage
  // lets an org owner/admin manage endpoints (see "hidden but allowed" below).
  orgOwner: { nav: MEMBER_NAV, billingHref: ROUTES.billing },
  orgAdmin: { nav: MEMBER_NAV, billingHref: ROUTES.billing },
  // team_role is not in the token, so a team admin's nav equals a member's.
  teamAdmin: { nav: MEMBER_NAV, billingHref: ROUTES.licenses },
  teamMember: { nav: MEMBER_NAV, billingHref: ROUTES.licenses },
  teamlessMember: { nav: MEMBER_NAV, billingHref: ROUTES.licenses },
  // KNOWN GAP (client#126): a logged-out visitor sees the whole app nav, and
  // "Billing & licenses" opens Billing (the billing probe never runs without
  // a token, so it reads as allowed). The decided target is a login screen.
  loggedOut: { nav: MEMBER_NAV, billingHref: ROUTES.billing },
};

describe("navigation matrix: sidebar per persona", APP_TEST, () => {
  afterEach(resetApp);

  it("covers every persona", () => {
    expect(Object.keys(EXPECTED_NAV).sort()).toEqual([...PERSONA_IDS].sort());
  });

  it.each(PERSONA_IDS)("the expected table for %s matches nav.ts's own gating", (id) => {
    expect(modelFromNavTs(PERSONAS[id])).toEqual(EXPECTED_NAV[id].nav);
  });

  it.each(PERSONA_IDS)("renders the expected sidebar for %s", async (id) => {
    renderApp(PERSONAS[id]);
    const { nav, billingHref } = EXPECTED_NAV[id];
    // Billing visibility settles after the subscription probe answers.
    await waitFor(() => expect(navHref("Billing & licenses")).toBe(billingHref), SETTLE);
    expect(renderedNav()).toEqual(nav);
  });

  it.each(tierVariants("orgOwner").map((p) => [p.tier, p] as const))(
    "does not change the sidebar by plan tier (%s)",
    async (_tier, persona) => {
      renderApp(persona);
      await waitFor(() => expect(navHref("Billing & licenses")).toBe(ROUTES.billing), SETTLE);
      expect(renderedNav()).toEqual(MEMBER_NAV);
    },
  );
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
    (id) => {
      renderApp(PERSONAS[id], ROUTES.publishSubmissions);
      expect(screen.getByRole("heading", { level: 1, name: "Plugin submissions" })).toBeTruthy();
      expect(screen.queryByRole("navigation", { name: "Publish sections" })).toBeNull();
    },
  );

  it.each([
    ["orgOwner", ["Billing", "Licenses"]],
    ["teamMember", null],
  ] as const)("Billing & licenses tabs for %s", async (id, expected) => {
    renderApp(PERSONAS[id], ROUTES.licenses);
    if (expected) {
      const tabs = await screen.findByRole("navigation", { name: "Billing & licenses sections" }, SETTLE);
      expect(within(tabs).getAllByRole("link").map((a) => a.textContent)).toEqual(expected);
    } else {
      await waitFor(() => expect(navHref("Billing & licenses")).toBe(ROUTES.licenses), SETTLE);
      expect(screen.queryByRole("navigation", { name: "Billing & licenses sections" })).toBeNull();
    }
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
    expect(!!screen.queryByRole("button", { name: "Add Member" })).toBe(canManage);
  });

  it("shows a team-less member no teams", async () => {
    renderApp(PERSONAS.teamlessMember, "/platform/teams");
    expect(await screen.findByText(/No teams yet/, {}, SETTLE)).toBeTruthy();
  });
});

// --- Route access per persona (today) ---------------------------------------
//
// The router has no guards: every route renders for everyone, and each page
// gates itself. These are the pages that lock a caller out with a callout
// (the text is the page's own), and who gets locked out today.

interface GatedRoute {
  path: string;
  heading: string;
  lockText: RegExp;
  /** Personas that get the page (no lock callout). Everyone else is locked. */
  open: PersonaId[];
}

const GATED_ROUTES: GatedRoute[] = [
  {
    path: "/rag/public-chat",
    heading: "Public Chat",
    lockText: /(Admin role required|Log in as an admin) to manage public chat endpoints/,
    open: ["platformAdmin", "orgOwner", "orgAdmin"],
  },
  {
    path: "/platform/backups",
    heading: "Backups",
    lockText: /(Admin role required|Log in as an admin) to view or manage backups/,
    open: ["platformAdmin"],
  },
  {
    path: "/organizations",
    heading: "All Organizations",
    lockText: /Admins only — log in with an admin account to manage organizations/,
    open: ["platformAdmin"],
  },
  {
    path: "/audit",
    heading: "Audit Log",
    lockText: /Admins only — log in with an admin account to view the audit log/,
    open: ["platformAdmin"],
  },
  {
    path: ROUTES.publishSubmissionReview,
    heading: "Submission review",
    lockText: /Admins only — log in with an admin account to review plugin/,
    open: ["platformAdmin"],
  },
  {
    path: "/platform/users",
    heading: "All users",
    lockText: /Only a Platform Admin can view every account|Log in as a Platform Admin to view or manage all users/,
    open: ["platformAdmin"],
  },
  {
    path: ROUTES.sources,
    heading: "MindHub & sources",
    lockText: /Only a Platform Admin can see this installation's MindHub connection/,
    open: ["platformAdmin"],
  },
];

const ROUTE_CASES = GATED_ROUTES.flatMap((route) =>
  PERSONA_IDS.map((id) => [route.path, id, route.open.includes(id) ? "open" : "locked", route] as const),
);

describe("route access matrix: page-level gates per persona", APP_TEST, () => {
  afterEach(resetApp);

  it.each(ROUTE_CASES)("%s as %s is %s", (path, id, access, route) => {
    renderApp(PERSONAS[id], path);
    // No route guard redirects anyone away; the page itself decides.
    expect(appLocation()?.pathname).toBe(path);
    expect(screen.getByRole("heading", { level: 1, name: route.heading })).toBeTruthy();
    const locked = route.lockText.test(document.querySelector("main")?.textContent ?? "");
    expect(locked ? "locked" : "open").toBe(access);
  });
});

// --- Known gaps --------------------------------------------------------------

/** Is the route's sidebar entry (or tab) visible to the persona per nav.ts? */
function navShows(persona: Persona, path: string): boolean {
  const access = personaNavAccess(persona);
  return NAV_SECTIONS.some((s) =>
    s.items.some((item) => {
      const entry = visibleEntry(item, access);
      return !!entry && (entry.to === path || !!entry.tabs?.some((t) => t.to === path));
    }),
  );
}

describe("known gaps (client#126)", APP_TEST, () => {
  afterEach(resetApp);

  // KNOWN GAP (client#126): visible but locked. Backups is in every member's
  // (and the logged-out visitor's) sidebar, but the page locks anyone who is
  // not an instance admin.
  it.each(PERSONA_IDS.filter((id) => id !== "platformAdmin"))(
    "Backups is in the nav for %s but the page locks them out",
    (id) => {
      expect(navShows(PERSONAS[id], "/platform/backups")).toBe(true);
      renderApp(PERSONAS[id], "/platform/backups");
      expect(screen.getByText(/to view or manage backups/)).toBeTruthy();
    },
  );

  // KNOWN GAP (client#126): hidden but allowed. Public Chat is adminOnly in
  // nav.ts (instance role), but PublicChatEndpointsPage (and the backend)
  // let an org owner/admin manage endpoints, so they can only reach it by URL.
  it.each(["orgOwner", "orgAdmin"] as const)(
    "Public Chat is hidden from %s although the page lets them manage it",
    async (id) => {
      expect(navShows(PERSONAS[id], "/rag/public-chat")).toBe(false);
      const { fetchMock } = renderApp(PERSONAS[id], "/rag/public-chat");
      expect(screen.queryByText(/to manage public chat endpoints/)).toBeNull();
      await waitFor(() =>
        expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/v1/public-chat/endpoints"))).toBe(
          true,
        ),
        SETTLE,
      );
    },
  );

  // KNOWN GAP (client#126): operator gating keys on the legacy instance role
  // (`role === "admin"`), not on `is_platform_admin`. A Platform Admin whose
  // token carries role "user" sees All Users (platformAdminOnly) but none of
  // the adminOnly operator entries, and the MindHub & sources page -- whose
  // copy says "Only a Platform Admin" -- locks them out.
  it("a Platform Admin without the legacy admin role loses the operator entries", async () => {
    const persona = withPersona("orgOwner", {
      label: "platform admin, role user",
      claims: { is_platform_admin: true },
    });
    renderApp(persona);
    await waitFor(() => expect(navHref("Billing & licenses")).toBe(ROUTES.billing), SETTLE);
    expect(renderedNav()).toEqual({
      ...MEMBER_NAV,
      Organization: [...MEMBER_NAV.Organization, "All Users"],
    });
    resetApp();
    renderApp(persona, ROUTES.sources);
    expect(screen.getByText(/Only a Platform Admin can see this installation/)).toBeTruthy();
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
