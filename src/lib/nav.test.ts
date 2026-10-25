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

const knowledgeEntry = NAV_SECTIONS.flatMap((s) => s.items).find((i) => i.to === "/rag")!;

const KNOWLEDGE_ROUTES = ["/rag", "/rag/graph", "/rag/taxonomy-review"];

describe("nav — Build › Knowledge (menu decision)", () => {
  it("keeps the Knowledge entry active on its three pages", () => {
    for (const route of KNOWLEDGE_ROUTES) {
      expect(entryIsActive(knowledgeEntry, route)).toBe(true);
    }
  });

  it("is not active on Assistants, chat history or the moved entity merges", () => {
    expect(entryIsActive(knowledgeEntry, "/rag/pipelines")).toBe(false);
    expect(entryIsActive(knowledgeEntry, "/rag/conversations")).toBe(false);
    expect(entryIsActive(knowledgeEntry, ROUTES.knowledgeQuality)).toBe(false);
  });

  it("groups knowledge bases, the graph and the member's taxonomy review as tabs", () => {
    for (const route of KNOWLEDGE_ROUTES) {
      const group = tabGroupForPath(route);
      expect(group?.label).toBe("Knowledge");
      expect(group?.tabs?.map((t) => t.to)).toEqual(KNOWLEDGE_ROUTES);
    }
    expect(tabGroupForPath("/rag/pipelines")).toBeNull();
  });

  it("groups a new chat and the chat history under Chat, though their paths differ", () => {
    for (const route of ["/ask", ROUTES.chatHistory]) {
      expect(tabGroupForPath(route)?.label).toBe("Chat");
    }
    expect(tabGroupForPath("/ask")?.tabs?.map((t) => t.label)).toEqual(["New chat", "History"]);
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

describe("nav — menu IA (client#126 menu decision)", () => {
  it("has Use / Build / Me, then the Organization and Platform areas", () => {
    expect(NAV_SECTIONS.map((s) => s.label)).toEqual(["Use", "Build", "Me", "Organization", "Platform"]);
    expect(section("Use").items.map((i) => i.label)).toEqual(["Home", "Chat"]);
    expect(section("Build").items.map((i) => i.label)).toEqual(["Knowledge", "Assistants", "Discover"]);
    expect(section("Me").items.map((i) => i.label)).toEqual(["My team", "My account"]);
    // Only the administration sections sit below the divider.
    expect(NAV_SECTIONS.filter((s) => s.admin).map((s) => s.label)).toEqual([
      "Organization",
      "Platform",
    ]);
  });

  it("shows Discover as plugins with Installed as a view, and no AI tools or modules", () => {
    for (const path of [ROUTES.discoverPlugins, ROUTES.installedPlugins]) {
      expect(tabLabels(path, MEMBER)).toEqual(["Plugins", "Installed"]);
    }
    const discoverLinks = section("Build")
      .items.flatMap((i) => [i, ...(i.tabs ?? [])])
      .map((l) => l.to);
    expect(discoverLinks).not.toContain(ROUTES.discoverAiTools);
    expect(discoverLinks).not.toContain(ROUTES.installedAiTools);
    expect(discoverLinks.some((to) => to.includes("bundles") || to.includes("modules"))).toBe(false);
    // The AI tools pages, reached from the plugin pages, sit under Discover.
    expect(entryIsActive(section("Build").items[2], ROUTES.installedAiTools)).toBe(true);
  });

  it("has no Publish, Submission review or personal Licenses entries", () => {
    const labels = NAV_SECTIONS.flatMap((s) => s.items)
      .flatMap((i) => [i, ...(i.tabs ?? [])])
      .map((l) => l.label);
    for (const gone of ["Publish", "Submissions", "Submission review", "Licenses"]) {
      expect(labels).not.toContain(gone);
    }
  });

  it("puts Profile, Voice and My requests under My account for every member", () => {
    expect(visibleRows("Me", MEMBER)).toEqual({ "My team": ROUTES.myTeam, "My account": ROUTES.account });
    expect(tabLabels(ROUTES.voice, MEMBER)).toEqual(["Profile", "Voice", "My requests"]);
  });

  it("puts the requests inbox under Organization › People for whoever decides org requests", () => {
    expect(tabLabels(ROUTES.requests, ORG_OWNER)).toEqual(["Members", "Invites", "Requests", "Domains"]);
    expect(visibleRows("Organization", MEMBER)).toEqual({});
  });

  it("shows Plan & billing in Organization behind the billing gate", () => {
    expect(visibleRows("Organization", BILLING_MEMBER)["Plan & billing"]).toBe(ROUTES.billing);
    expect(visibleRows("Organization", ORG_OWNER)["Plan & billing"]).toBe(ROUTES.billing);
  });

  it("shows the Platform area to operators only, Status and Local models included", () => {
    expect(visibleRows("Platform", MEMBER)).toEqual({});
    expect(visibleRows("Platform", ORG_OWNER)).toEqual({});
    // Operator screens want the Platform Admin claim, as their APIs do; the
    // instance admin role alone (an org owner, an SSO admin) is not enough.
    expect(visibleRows("Platform", LEGACY_ADMIN)).toEqual({});
    expect(visibleRows("Platform", ADMIN)).toEqual({
      "Status & logs": ROUTES.status,
      "Local models": ROUTES.models,
      Modules: ROUTES.modules,
      "All organizations": ROUTES.allOrganizations,
      "All users": ROUTES.allUsers,
      "MindHub & sources": ROUTES.sources,
      Backups: ROUTES.backups,
      "Platform audit log": ROUTES.platformAudit,
    });
    expect(tabLabels(ROUTES.installedModules, ADMIN)).toEqual(["Discover", "Installed"]);
    const sources = section("Platform").items.find((i) => i.to === ROUTES.sources)!;
    expect(entryIsActive(sources, `${ROUTES.sources}/r1`)).toBe(true);
    const account = section("Me").items.find((i) => i.to === ROUTES.account)!;
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
      "/organization": "org.settings.manage",
      [ORG_USERS_PATH]: "org.members.manage",
      [ROUTES.peopleInvites]: "org.members.manage",
      [ROUTES.requests]: "org.settings.manage",
      [ROUTES.peopleDomains]: "org.settings.manage",
      [ROUTES.orgTeams]: "org.teams.manage",
      [ROUTES.orgAi]: "org.ai.manage",
      [ROUTES.orgAiDefaults]: "org.ai.manage",
      [ROUTES.orgPlugins]: "org.settings.manage",
      [ROUTES.chatbots]: "org.chatbots.manage",
      [ROUTES.knowledgeQuality]: "org.settings.manage",
      [ROUTES.orgAudit]: "org.audit.view",
      [ROUTES.billing]: "org.billing.view",
      [ROUTES.status]: "platform-admin",
      [ROUTES.models]: "platform-admin",
      [ROUTES.modules]: "platform-admin",
      [ROUTES.installedModules]: "platform-admin",
      [ROUTES.allOrganizations]: "platform-admin",
      [ROUTES.allUsers]: "platform-admin",
      [ROUTES.sources]: "platform-admin",
      [ROUTES.backups]: "platform-admin",
      [ROUTES.platformAudit]: "platform-admin",
    });
  });

  it("shows the Organization area to org owners/admins, in the decided order", () => {
    expect(Object.keys(visibleRows("Organization", ORG_OWNER))).toEqual([
      "Overview",
      "People",
      "Teams",
      "AI",
      "Plugins",
      "Website chatbots",
      "Knowledge quality",
      "Security",
      "Plan & billing",
    ]);
    expect(visibleRows("Organization", ORG_OWNER).Security).toBe(ROUTES.orgAudit);
    expect(visibleRows("Organization", ORG_OWNER).People).toBe(ORG_USERS_PATH);
    expect(NAV_SECTIONS.some((s) => s.label === "Team")).toBe(false);
  });

  it("shows a signed-out visitor no sections at all", () => {
    expect(visibleSections(NAV_SECTIONS, SIGNED_OUT)).toEqual([]);
  });

  it("titles every tab with a phrase that contains its tab label", () => {
    for (const sections of [NAV_SECTIONS, localizeNav(tr)]) {
      for (const entry of sections.flatMap((s) => s.items)) {
        for (const tab of entry.tabs ?? []) {
          if (!tab.title) continue;
          expect(tab.title.toLowerCase()).toContain(tab.label.toLowerCase());
        }
      }
    }
  });

  it("links only to routes declared in lib/routes.ts outside Use and Build", () => {
    const declared = new Set<string>(Object.values(ROUTES));
    const links = NAV_SECTIONS.filter((s) => s.label !== "Use" && s.label !== "Build")
      .flatMap((s) => s.items)
      .flatMap((i) => [i, ...(i.tabs ?? [])])
      .map((l) => l.to)
      .filter((to) => to !== "/organization");
    for (const to of links) expect(declared.has(to)).toBe(true);
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

  it("labels each grouped destination with its page title", () => {
    const byRoute = Object.fromEntries(NAV_DESTINATIONS.map((d) => [d.to, d.label]));
    expect(byRoute).toMatchObject({
      "/ask": "Chat: New chat",
      [ROUTES.chatHistory]: "Chat: History",
      [ROUTES.discoverPlugins]: "Discover plugins",
      [ROUTES.installedPlugins]: "Installed plugins",
      [ROUTES.account]: "My account: Profile",
      [ROUTES.myRequests]: "My requests",
      [ROUTES.requests]: "Requests",
      [ROUTES.modules]: "Discover modules",
      [ROUTES.installedModules]: "Installed modules",
      [ROUTES.orgAudit]: "Audit log",
      [ROUTES.platformAudit]: "Platform audit log",
      [ROUTES.billing]: "Plan & billing",
      [ROUTES.sources]: "MindHub & sources",
    });
  });

  it("finds pages by their old names too (marketplace, service bundles, pipelines, licenses)", () => {
    expect(find("plugins")).toEqual(expect.arrayContaining([ROUTES.discoverPlugins, ROUTES.installedPlugins]));
    expect(find("marketplace")).toEqual(expect.arrayContaining([ROUTES.discoverPlugins, ROUTES.installedPlugins]));
    expect(find("bundles")).toEqual(expect.arrayContaining([ROUTES.modules, ROUTES.installedModules]));
    expect(find("pipelines")).toContain("/rag/pipelines");
    expect(find("licenses")).toContain(ROUTES.billing);
    expect(find("mindhub")).toContain(ROUTES.sources);
    expect(find("entity merge")).toEqual([ROUTES.knowledgeQuality]);
  });

  it("applies the same role gates as the sidebar", () => {
    expect(find("mindhub", MEMBER)).not.toContain(ROUTES.sources);
    expect(find("bundles", MEMBER)).toEqual([]);
    expect(find("subscription", MEMBER)).not.toContain(ROUTES.billing);
    expect(find("request", MEMBER)).toEqual([ROUTES.myRequests]);
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
    expect(turkish.map((s) => s.label)).toEqual(["Kullan", "Oluştur", "Ben", "Kurum", "Platform"]);
    expect(turkish.map((s) => s.items.map((i) => i.label))).toEqual([
      ["Ana sayfa", "Sohbet"],
      ["Bilgi", "Asistanlar", "Keşfet"],
      ["Takımım", "Hesabım"],
      [
        "Genel bakış",
        "İnsanlar",
        "Takımlar",
        "Yapay zekâ",
        "Eklentiler",
        "Web sitesi sohbet botları",
        "Bilgi kalitesi",
        "Güvenlik",
        "Plan ve fatura",
      ],
      [
        "Durum ve kayıtlar",
        "Yerel modeller",
        "Modüller",
        "Tüm kurumlar",
        "Tüm kullanıcılar",
        "MindHub ve kaynaklar",
        "Yedekler",
        "Platform denetim kaydı",
      ],
    ]);
    expect(tabGroupForPath(ROUTES.voice, turkish)?.tabs?.map((t) => t.label)).toEqual([
      "Profil",
      "Ses",
      "İsteklerim",
    ]);
    const destinations = navDestinations(turkish, tr);
    expect(destinations.find((d) => d.to === ROUTES.installedPlugins)?.label).toBe("Kurulu eklentiler");
    // A tab without a page title of its own reads "<entry>: <tab>".
    expect(destinations.find((d) => d.to === "/rag/taxonomy-review")?.label).toBe(
      "Bilgi: Sınıflandırma incelemesi",
    );
    expect(destinations.find((d) => d.to === "/")?.group).toBe("Kullan");
  });
});

describe("nav — breadcrumb trail (#131)", () => {
  const trail = (path: string) => {
    const t = navTrailForPath(path, NAV_SECTIONS);
    return t && [t.section ?? null, t.entry.label, t.tab?.label ?? null];
  };

  it("names the section, entry and tab of a page", () => {
    expect(trail("/rag/taxonomy-review")).toEqual(["Build", "Knowledge", "Taxonomy Review"]);
    expect(trail(ROUTES.installedPlugins)).toEqual(["Build", "Discover", "Installed"]);
    expect(trail(ROUTES.installedAiTools)).toEqual(["Build", "Discover", null]);
    expect(trail("/rag/pipelines")).toEqual(["Build", "Assistants", null]);
    expect(trail(ROUTES.chatHistory)).toEqual(["Use", "Chat", "History"]);
    expect(trail(`${ROUTES.sources}/r1`)).toEqual(["Platform", "MindHub & sources", null]);
    expect(trail(ROUTES.myRequests)).toEqual(["Me", "My account", "My requests"]);
    expect(trail(ROUTES.myTeam)).toEqual(["Me", "My team", null]);
    expect(trail(ROUTES.requests)).toEqual(["Organization", "People", "Requests"]);
    expect(trail(`${ROUTES.chatbots}/3/conversations`)).toEqual(["Organization", "Website chatbots", null]);
    expect(trail(ROUTES.orgAudit)).toEqual(["Organization", "Security", "Audit log"]);
    expect(trail(ROUTES.installedModules)).toEqual(["Platform", "Modules", "Installed"]);
    expect(trail(ROUTES.platformAudit)).toEqual(["Platform", "Platform audit log", null]);
  });

  it("puts the top group's pages under their section", () => {
    expect(trail("/ask")).toEqual(["Use", "Chat", "New chat"]);
  });

  it("has no trail on Home, sign-in pages or unknown paths", () => {
    expect(trail("/")).toBeNull();
    expect(trail("/login")).toBeNull();
    expect(trail("/no-such-page")).toBeNull();
  });
});
