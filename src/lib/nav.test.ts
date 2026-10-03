import { describe, expect, it } from "vitest";

import {
  NAV_DESTINATIONS,
  NAV_SECTIONS,
  entryIsActive,
  leafVisible,
  tabGroupForPath,
  visibleEntry,
  type NavAccess,
  type NavEntry,
} from "./nav";
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
      "/rag/public-chat",
      "/rag/graph",
    ]);
    // …Taxonomy Review / Entity Merge Review are reachable only as tabs.
    expect(topLevel).not.toContain("/rag/taxonomy-review");
    expect(topLevel).not.toContain("/rag/entity-merges");
  });
});

const MEMBER: NavAccess = { isAdmin: false, billing: false };
const BILLING_MEMBER: NavAccess = { isAdmin: false, billing: true };
const ADMIN: NavAccess = { isAdmin: true, billing: true };

function section(label: string) {
  return NAV_SECTIONS.find((s) => s.label === label)!;
}

/** What the sidebar shows for a section: entry label → link target. */
function visibleRows(label: string, access: NavAccess): Record<string, string> {
  return Object.fromEntries(
    section(label)
      .items.map((i) => visibleEntry(i, access))
      .filter((i): i is NavEntry => i !== null)
      .map((i) => [i.label, i.to]),
  );
}

function tabLabels(path: string, access: NavAccess): string[] {
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
      "Platform",
      "Organization",
      "Installation settings",
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

  it("shows Submission review in Publish to admins only, leaving members the Submissions page", () => {
    expect(tabLabels(ROUTES.publishSubmissions, MEMBER)).toEqual(["Submissions"]);
    expect(tabLabels(ROUTES.publishSubmissionReview, ADMIN)).toEqual([
      "Submissions",
      "Submission review",
    ]);
    expect(visibleRows("Marketplace", MEMBER).Publish).toBe(ROUTES.publishSubmissions);
  });

  it("puts Licenses next to Billing, keeping Billing's #64 gate", () => {
    expect(tabLabels(ROUTES.licenses, BILLING_MEMBER)).toEqual(["Billing", "Licenses"]);
    // Licenses alone: one tab, so PageTabs shows no strip.
    expect(tabLabels(ROUTES.licenses, MEMBER)).toEqual(["Licenses"]);
    expect(visibleRows("Organization", BILLING_MEMBER)["Billing & licenses"]).toBe(ROUTES.billing);
    expect(visibleRows("Organization", MEMBER)["Billing & licenses"]).toBe(ROUTES.licenses);
  });

  it("shows Installation settings › MindHub & sources to admins only", () => {
    expect(visibleRows("Installation settings", MEMBER)).toEqual({});
    expect(visibleRows("Installation settings", BILLING_MEMBER)).toEqual({});
    expect(visibleRows("Installation settings", ADMIN)).toEqual({ "MindHub & sources": ROUTES.sources });
    const entry = section("Installation settings").items[0];
    expect(entryIsActive(entry, `${ROUTES.sources}/r1`)).toBe(true);
    expect(entryIsActive(entry, "/settings")).toBe(false);
  });

  it("keeps the other role gates exactly as before", () => {
    const adminOnly = NAV_SECTIONS.flatMap((s) => s.items)
      .flatMap((i) => [i, ...(i.tabs ?? [])])
      .filter((l) => l.adminOnly)
      .map((l) => l.to);
    expect(adminOnly).toEqual([
      "/rag/public-chat",
      ROUTES.publishSubmissionReview,
      "/platform/providers",
      "/organizations",
      "/platform/users",
      "/audit",
      ROUTES.sources,
    ]);
    const billingOnly = NAV_SECTIONS.flatMap((s) => s.items)
      .flatMap((i) => [i, ...(i.tabs ?? [])])
      .filter((l) => l.requiresBilling)
      .map((l) => l.to);
    expect(billingOnly).toEqual([ROUTES.billing]);
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
    const marketplaceLinks = [...section("Marketplace").items, ...section("Installation settings").items]
      .flatMap((i) => [i, ...(i.tabs ?? [])])
      .map((l) => l.to);
    for (const to of marketplaceLinks) expect(declared.has(to)).toBe(true);
  });
});

describe("nav — command palette destinations", () => {
  function find(query: string, access: NavAccess = ADMIN): string[] {
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
