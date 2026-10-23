import { describe, expect, it } from "vitest";

import { tr } from "../i18n/messages/tr";
import {
  NAV_DESTINATIONS,
  NAV_SECTIONS,
  entryIsActive,
  leafVisible,
  localizeNav,
  navDestinations,
  tabGroupForPath,
  navTrailForPath,
  visibleEntry,
  visibleSections,
  type NavEntry,
} from "./nav";
import { ORG_USERS_PATH } from "./orgs";
import { accessFrom, effectivePermissionsFromRoles, type Access, type RoleFacts } from "./permissions";
import { ROUTES } from "./routes";

const graphEntry = NAV_SECTIONS.flatMap((s) => s.items).find(
  (i) => i.to === "/rag/graph",
)!;

const GRAPH_ROUTES = ["/rag/graph", "/rag/taxonomy-review", "/rag/entity-merges"];

describe("nav — Knowledge Graph grouping (#1230)", () => {
  it("keeps the Knowledge Graph entry active on all three graph surfaces", () => {
    for (const route of GRAPH_ROUTES) {
      expect(entryIsActive(graphEntry, route)).toBe(true);
    }
  });

  it("is not active on the golden-path Knowledge routes", () => {
    expect(entryIsActive(graphEntry, "/rag")).toBe(false);
    expect(entryIsActive(graphEntry, "/rag/pipelines")).toBe(false);
    expect(entryIsActive(graphEntry, "/rag/conversations")).toBe(false);
  });

  it("groups the three surfaces as tabs under one Knowledge Graph entry", () => {
    for (const route of GRAPH_ROUTES) {
      const group = tabGroupForPath(route);
      expect(group?.label).toBe("Knowledge Graph");
      expect(group?.tabs?.map((t) => t.to)).toEqual(GRAPH_ROUTES);
    }
  });

  it("no tab group on the golden-path routes", () => {
    expect(tabGroupForPath("/rag")).toBeNull();
    expect(tabGroupForPath("/rag/pipelines")).toBeNull();
  });

  it("demotes the advanced surfaces out of the top-level Knowledge rows", () => {
    const knowledge = NAV_SECTIONS.find((s) => s.label === "Knowledge")!;
    const topLevel = knowledge.items.map((i) => i.to);
    // The golden path + the single grouped entry are top-level…
    expect(topLevel).toEqual([
      "/rag",
      "/rag/pipelines",
      "/rag/conversations",
      "/rag/graph",
    ]);
    // …Taxonomy Review / Entity Merge Review are reachable only as tabs.
    expect(topLevel).not.toContain("/rag/taxonomy-review");
    expect(topLevel).not.toContain("/rag/entity-merges");
  });
});

function can(facts: Partial<RoleFacts>): Access {
  return access({
    authenticated: true,
    role: "user",
    orgRole: "member",
    isPlatformAdmin: false,
    activeOrgId: "1",
    billingVisible: false,
    ...facts,
  });
}

function access(facts: RoleFacts): Access {
  return accessFrom(effectivePermissionsFromRoles(facts));
}

const MEMBER = can({});
const BILLING_MEMBER = can({ billingVisible: true });
const ORG_OWNER = can({ orgRole: "owner", billingVisible: true });
const ADMIN = can({ role: "admin", isPlatformAdmin: true, billingVisible: true });
/** The legacy instance "admin" role without the Platform Admin claim. */
const LEGACY_ADMIN = can({ role: "admin", billingVisible: true });
const SIGNED_OUT = access({
  authenticated: false,
  role: "",
  orgRole: "",
  isPlatformAdmin: false,
  activeOrgId: "",
  billingVisible: true,
});

function section(label: string) {
  return NAV_SECTIONS.find((s) => s.label === label)!;
}

/** What the sidebar shows for a section: entry label → link target. */
function visibleRows(label: string, access: Access): Record<string, string> {
  return Object.fromEntries(
    section(label)
      .items.map((i) => visibleEntry(i, access))
      .filter((i): i is NavEntry => i !== null)
      .map((i) => [i.label, i.to]),
  );
}

function tabLabels(path: string, access: Access): string[] {
  const entry = tabGroupForPath(path);
  return (entry && visibleEntry(entry, access)?.tabs?.map((t) => t.label)) ?? [];
}

describe("nav — marketplace IA (#2197)", () => {
  it("has one Marketplace section with Discover / Installed / Publish", () => {
    expect(section("Marketplace").items.map((i) => i.label)).toEqual([
      "Discover",
      "Installed",
      "Publish",
    ]);
    expect(NAV_SECTIONS.map((s) => s.label)).toEqual([
      undefined,
      "Knowledge",
      "Marketplace",
      "AI & system",
      "Team",
      "My account",
      "Organization",
      "Platform",
    ]);
    // Only the administration sections sit below the divider.
    expect(NAV_SECTIONS.filter((s) => s.admin).map((s) => s.label)).toEqual([
      "Organization",
      "Platform",
    ]);
  });

  it("shows plugins, AI tools and service bundles as tabs of Discover and of Installed", () => {
    for (const path of ["/marketplace/discover/plugins", "/marketplace/installed/ai-tools"]) {
      expect(tabLabels(path, MEMBER)).toEqual(["Plugins", "AI tools", "Service bundles"]);
    }
    expect(tabGroupForPath("/marketplace/discover/service-bundles")?.tabs?.map((t) => t.to)).toEqual([
      ROUTES.discoverPlugins,
      ROUTES.discoverAiTools,
      ROUTES.discoverServiceBundles,
    ]);
    expect(tabGroupForPath("/marketplace/installed/plugins")?.tabs?.map((t) => t.to)).toEqual([
      ROUTES.installedPlugins,
      ROUTES.installedAiTools,
      ROUTES.installedServiceBundles,
    ]);
  });

  it("moves service bundles out of Platform", () => {
    const platform = section("Platform").items.map((i) => i.to);
    expect(platform.some((to) => to.includes("bundles"))).toBe(false);
  });

  it("shows Submission review in Publish to operators only, leaving members the Submissions page", () => {
    expect(tabLabels(ROUTES.publishSubmissions, MEMBER)).toEqual(["Submissions"]);
    expect(tabLabels(ROUTES.publishSubmissionReview, ADMIN)).toEqual([
      "Submissions",
      "Submission review",
    ]);
    expect(visibleRows("Marketplace", MEMBER).Publish).toBe(ROUTES.publishSubmissions);
  });

  it("puts Licenses in My account for everyone and Billing in Organization behind the billing gate", () => {
    expect(visibleRows("My account", MEMBER).Licenses).toBe(ROUTES.licenses);
    expect(visibleRows("Organization", MEMBER).Billing).toBeUndefined();
    expect(visibleRows("Organization", BILLING_MEMBER).Billing).toBe(ROUTES.billing);
    // Billing no longer owns /billing/licenses.
    const billing = section("Organization").items.find((i) => i.to === ROUTES.billing)!;
    expect(entryIsActive(billing, ROUTES.licenses)).toBe(false);
    expect(tabGroupForPath(ROUTES.licenses)).toBeNull();
  });

  it("shows Platform › MindHub & sources to operators only", () => {
    expect(visibleRows("Platform", MEMBER)).toEqual({});
    expect(visibleRows("Platform", ORG_OWNER)).toEqual({});
    expect(visibleRows("Platform", ADMIN)["MindHub & sources"]).toBe(ROUTES.sources);
    const entry = section("Platform").items.find((i) => i.to === ROUTES.sources)!;
    expect(entryIsActive(entry, `${ROUTES.sources}/r1`)).toBe(true);
    expect(entryIsActive(entry, "/settings")).toBe(false);
    // My account › Profile & settings is not active on the sources pages.
    const account = section("My account").items.find((i) => i.to === "/settings")!;
    expect(entryIsActive(account, ROUTES.sources)).toBe(false);
  });

  it("gates every entry and tab: org screens on catalogue keys, operator screens on the Platform Admin", () => {
    const permissions = Object.fromEntries(
      NAV_SECTIONS.flatMap((s) => s.items)
        .flatMap((i) => [i, ...(i.tabs ?? [])])
        .filter((l) => l.requires !== "member")
        .map((l) => [l.to, l.requires]),
    );
    expect(permissions).toEqual({
      [ROUTES.publishSubmissionReview]: "platform-admin",
      "/organization": "org.settings.manage",
      [ORG_USERS_PATH]: "org.members.manage",
      [ROUTES.peopleInvites]: "org.members.manage",
      [ROUTES.peopleDomains]: "org.settings.manage",
      "/rag/public-chat": "org.chatbots.manage",
      [ROUTES.orgAi]: "org.ai.manage",
      [ROUTES.orgAiDefaults]: "org.ai.manage",
      [ROUTES.orgPlugins]: "org.settings.manage",
      [ROUTES.billing]: "org.billing.view",
      "/audit": "org.audit.view",
      "/organizations": "platform-admin",
      "/platform/users": "platform-admin",
      "/platform/backups": "platform-admin",
      [ROUTES.sources]: "platform-admin",
    });
  });

  it("shows the Organization section to org owners/admins and All Users to Platform Admins only", () => {
    expect(visibleRows("Organization", MEMBER)).toEqual({});
    expect(visibleRows("Organization", ORG_OWNER).People).toBe(ORG_USERS_PATH);
    expect(visibleRows("Organization", ORG_OWNER)["Audit Log"]).toBe("/audit");
    // Operator screens want the Platform Admin claim, as their APIs do; the
    // instance admin role alone (an org owner, an SSO admin) is not enough.
    expect(visibleRows("Platform", LEGACY_ADMIN)).toEqual({});
    expect(visibleRows("Platform", ADMIN).Backups).toBe("/platform/backups");
    expect(visibleRows("Platform", ADMIN)["MindHub & sources"]).toBe(ROUTES.sources);
    expect(visibleRows("Platform", ADMIN)["All Users"]).toBe("/platform/users");
  });

  it("shows a signed-out visitor no sections at all", () => {
    expect(visibleSections(NAV_SECTIONS, SIGNED_OUT)).toEqual([]);
  });

  it("titles every tab with a phrase that contains its tab label", () => {
    for (const entry of NAV_SECTIONS.flatMap((s) => s.items)) {
      for (const tab of entry.tabs ?? []) {
        if (!tab.title) continue;
        expect(tab.title.toLowerCase()).toContain(tab.label.toLowerCase());
      }
    }
  });

  it("only links to routes declared in lib/routes.ts for the moved pages", () => {
    const declared = new Set<string>(Object.values(ROUTES));
    const marketplaceLinks = [...section("Marketplace").items, section("Platform").items.at(-1)!]
      .flatMap((i) => [i, ...(i.tabs ?? [])])
      .map((l) => l.to);
    for (const to of marketplaceLinks) expect(declared.has(to)).toBe(true);
  });
});

describe("nav — command palette destinations", () => {
  function find(query: string, access: Access = ADMIN): string[] {
    const terms = query.toLowerCase().split(/\s+/);
    return NAV_DESTINATIONS.filter((d) => leafVisible(d, access))
      .filter((d) => {
        const hay = `${d.label} ${d.description ?? ""} ${d.group} ${d.keywords ?? ""}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      })
      .map((d) => d.to);
  }

  it("labels each marketplace destination with its page title", () => {
    const byRoute = Object.fromEntries(NAV_DESTINATIONS.map((d) => [d.to, d.label]));
    expect(byRoute).toMatchObject({
      [ROUTES.discoverPlugins]: "Discover plugins",
      [ROUTES.discoverAiTools]: "Discover AI tools",
      [ROUTES.discoverServiceBundles]: "Discover service bundles",
      [ROUTES.installedPlugins]: "Installed plugins",
      [ROUTES.installedAiTools]: "Installed AI tools",
      [ROUTES.installedServiceBundles]: "Installed service bundles",
      [ROUTES.publishSubmissions]: "Plugin submissions",
      [ROUTES.publishSubmissionReview]: "Submission review",
      [ROUTES.billing]: "Billing",
      [ROUTES.licenses]: "Plugin licenses",
      [ROUTES.sources]: "MindHub & sources",
    });
  });

  it("still finds the marketplace by plugins, AI tools, catalog and marketplace", () => {
    expect(find("plugins")).toEqual(expect.arrayContaining([ROUTES.discoverPlugins, ROUTES.installedPlugins]));
    expect(find("ai tools")).toEqual(expect.arrayContaining([ROUTES.discoverAiTools, ROUTES.installedAiTools]));
    expect(find("catalog")).toEqual(expect.arrayContaining([ROUTES.discoverPlugins, ROUTES.discoverAiTools]));
    expect(find("marketplace")).toEqual(
      expect.arrayContaining([ROUTES.discoverPlugins, ROUTES.installedPlugins, ROUTES.publishSubmissions]),
    );
    expect(find("bundles")).toEqual(
      expect.arrayContaining([ROUTES.discoverServiceBundles, ROUTES.installedServiceBundles]),
    );
    expect(find("licenses")).toContain(ROUTES.licenses);
    expect(find("mindhub")).toContain(ROUTES.sources);
  });

  it("finds pages by their old names too (review queue, live tools)", () => {
    expect(find("review queue")).toEqual([ROUTES.publishSubmissionReview]);
    expect(find("live")).toContain(ROUTES.installedAiTools);
  });

  it("applies the same role gates as the sidebar", () => {
    expect(find("mindhub", MEMBER)).not.toContain(ROUTES.sources);
    expect(find("review queue", MEMBER)).toEqual([]);
    expect(find("subscription", MEMBER)).not.toContain(ROUTES.billing);
    expect(find("licenses", MEMBER)).toContain(ROUTES.licenses);
  });
});

describe("nav — localized copy (i18n)", () => {
  const routes = (sections: ReturnType<typeof localizeNav>) =>
    sections.map((s) => s.items.map((i) => [i.to, (i.tabs ?? []).map((t) => t.to)]));
  const turkish = localizeNav(tr);

  it("has the same structure in every language", () => {
    expect(routes(turkish)).toEqual(routes(NAV_SECTIONS));
  });

  it("labels sections, entries, tabs and palette destinations in the language", () => {
    expect(turkish.map((s) => s.label)).toEqual([
      undefined,
      "Bilgi",
      "Pazar yeri",
      "Yapay zekâ ve sistem",
      "Ekip",
      "Hesabım",
      "Kuruluş",
      "Platform",
    ]);
    expect(turkish[0].items.map((i) => i.label)).toEqual(["Ana sayfa", "Sor"]);
    expect(tabGroupForPath(ROUTES.installedAiTools, turkish)?.tabs?.map((t) => t.label)).toEqual([
      "Eklentiler",
      "Yapay zekâ araçları",
      "Hizmet paketleri",
    ]);
    const destinations = navDestinations(turkish, tr);
    expect(destinations.find((d) => d.to === ROUTES.installedAiTools)?.label).toBe(
      "Kurulu yapay zekâ araçları",
    );
    // A tab without a page title of its own reads "<entry>: <tab>".
    expect(destinations.find((d) => d.to === "/rag/taxonomy-review")?.label).toBe(
      "Bilgi grafiği: Sınıflandırma incelemesi",
    );
    expect(destinations.find((d) => d.to === "/")?.group).toBe("Genel");
  });
});

describe("nav — breadcrumb trail (#131)", () => {
  const trail = (path: string) => {
    const t = navTrailForPath(path, NAV_SECTIONS);
    return t && [t.section ?? null, t.entry.label, t.tab?.label ?? null];
  };

  it("names the section, entry and tab of a page", () => {
    expect(trail("/rag/taxonomy-review")).toEqual(["Knowledge", "Knowledge Graph", "Taxonomy Review"]);
    expect(trail(ROUTES.installedAiTools)).toEqual(["Marketplace", "Installed", "AI tools"]);
    expect(trail("/rag/pipelines")).toEqual(["Knowledge", "Pipelines", null]);
    expect(trail(`${ROUTES.sources}/r1`)).toEqual(["Platform", "MindHub & sources", null]);
    expect(trail(ROUTES.licenses)).toEqual(["My account", "Licenses", null]);
  });

  it("puts the heading-less top group directly under Home", () => {
    expect(trail("/ask")).toEqual([null, "Ask", null]);
  });

  it("has no trail on Home, sign-in pages or unknown paths", () => {
    expect(trail("/")).toBeNull();
    expect(trail("/login")).toBeNull();
    expect(trail("/no-such-page")).toBeNull();
  });
});
