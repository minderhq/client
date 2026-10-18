import { useMemo } from "react";

import type { IconName } from "../components/Icon";
import { en, useI18n, type Messages } from "../i18n";
import { ORG_USERS_PATH } from "./orgs";
import { allows, MEMBER, PLATFORM_ADMIN, type Access, type Requirement } from "./permissions";
import { ROUTES } from "./routes";

/** A navigable destination (a real route). */
export interface NavLeaf {
  to: string;
  label: string;
  icon: IconName;
  /** NavLink `end` — match this route exactly (index routes like /rag). */
  end?: boolean;
  /** The page's own heading (PageHeader) and its command-palette label, when
   * it differs from the short tab label: a tab reads "Plugins" inside the
   * Discover strip, the page and the palette say "Discover plugins". Tests
   * hold every page's rendered title to this value. */
  title?: string;
  /** Who sees this leaf (sidebar row, tab or palette entry): a permission
   * key, any signed-in member, or the Platform Admin (lib/permissions.ts,
   * useCan). The one gate; there are no role flags. */
  requires: Requirement;
  /** Extra search terms for the command palette (synonyms not in the label). */
  keywords?: string;
  /** One-line "what you do here", shown as a sidebar tooltip, on the page
   * (PageTabs), and as the command-palette sublabel. */
  description?: string;
}

/** A sidebar entry. Most are plain links; a few own several closely-related
 * sub-pages (the old "Available / Installed / …" split) and show as ONE
 * sidebar item, exposing the rest as in-page tabs (see PageTabs). */
export interface NavEntry extends NavLeaf {
  /** Pathname prefix(es) that keep this entry highlighted for any of its
   * routes. Usually one shared prefix (e.g. "/plugins"); an array lets an entry
   * own sibling pages that DON'T share a prefix — the graph surfaces
   * (/rag/graph, /rag/taxonomy-review, /rag/entity-merges) nest under one
   * "Knowledge Graph" entry that way (#1230). */
  match?: string | string[];
  /** Sub-pages surfaced as tabs on each of the group's pages, not as their own
   * sidebar rows — this is what collapses the repetitive Available/Installed
   * duplication that made the old nav twice as long and twice as confusing.
   * An entry with tabs is shown when at least one tab is visible to the
   * caller, and links to the first such tab (see visibleEntry). */
  tabs?: NavLeaf[];
}

export interface NavSection {
  /** Omitted for the top (Home/Ask) group, which needs no heading. */
  label?: string;
  /** An administration section (Organization, Platform): drawn below a
   * divider, apart from the sections everyone uses. */
  admin?: boolean;
  items: NavEntry[];
}

/** The catalog id of an entry's copy (`nav.items.<id>`). */
export type NavItemId = keyof Messages["nav"]["items"];
type NavSectionId = keyof Messages["nav"]["sections"];

/** An entry's copy in one language. */
interface NavCopy {
  label: string;
  title?: string;
  description?: string;
  keywords?: string;
}

/** A leaf as declared below: routing and gating only, copy by `id`. */
type NavLeafDef = Omit<NavLeaf, "label" | "title" | "description" | "keywords"> & {
  id: NavItemId;
};
type NavEntryDef = Omit<NavEntry, "label" | "title" | "description" | "keywords" | "tabs"> & {
  id: NavItemId;
  tabs?: NavLeafDef[];
};
interface NavSectionDef {
  /** Omitted for the top (Home/Ask) group, which needs no heading. */
  id?: NavSectionId;
  admin?: boolean;
  items: NavEntryDef[];
}

/**
 * The app's information architecture (#126, #131): one panel for everyone,
 * grouped by what the user is trying to DO rather than by which backend
 * service powers it. Everyone gets the sections they work in (Knowledge,
 * Marketplace, AI & system, Team, My account); the administration sections
 * (Organization, Platform) sit below a divider and appear only to callers
 * who hold their permissions. Each row names the permission it needs; the
 * sidebar, tabs and palette filter through useCan, never through role names.
 *
 * Read-only system views (Models, Status, Installed) stay open to every
 * member; changing them is gated on the pages and by the API.
 *
 * Labels, page titles, descriptions and palette keywords are not here: each
 * entry's `id` names its copy in the message catalogs (`nav.items.<id>`), so
 * the menu follows the active language (see localizeNav).
 */
const NAV_MODEL: NavSectionDef[] = [
  {
    items: [
      { to: "/", id: "home", icon: "home", end: true, requires: MEMBER },
      { to: "/ask", id: "ask", icon: "ask", requires: MEMBER },
    ],
  },
  {
    id: "knowledge",
    items: [
      { to: "/rag", id: "knowledgeBases", icon: "knowledge-bases", end: true, requires: MEMBER },
      { to: "/rag/pipelines", id: "pipelines", icon: "pipelines", requires: MEMBER },
      { to: "/rag/conversations", id: "conversations", icon: "conversations", requires: MEMBER },
      // Graph / Taxonomy Review / Entity Merge Review are advanced surfaces a
      // first-timer has no data for — nested under one "Knowledge Graph" entry
      // as in-page tabs (#1230) so top-level Knowledge is just the golden path
      // (KB · Pipelines · Conversations). They don't share a path prefix, hence
      // the match[] array. Taxonomy review is per owner: every member reviews
      // the suggestions on their own entities.
      {
        to: "/rag/graph",
        id: "knowledgeGraph",
        icon: "graph",
        requires: MEMBER,
        match: ["/rag/graph", "/rag/taxonomy-review", "/rag/entity-merges"],
        tabs: [
          { to: "/rag/graph", id: "graph", icon: "graph", end: true, requires: MEMBER },
          { to: "/rag/taxonomy-review", id: "taxonomyReview", icon: "taxonomy", requires: MEMBER },
          { to: "/rag/entity-merges", id: "entityMerges", icon: "merge", requires: MEMBER },
        ],
      },
    ],
  },
  {
    // Marketplace (#2197): ONE Discover catalog, ONE Installed view, ONE
    // Publish area. The item type is the tab; a plugin's source (first-party,
    // private git, submitted, later MindHub) is a filter and badge on Discover.
    id: "marketplace",
    items: [
      {
        to: ROUTES.discoverPlugins,
        id: "discover",
        icon: "available-plugins",
        requires: MEMBER,
        match: "/marketplace/discover",
        tabs: [
          { to: ROUTES.discoverPlugins, id: "discoverPlugins", icon: "plugins", requires: MEMBER },
          { to: ROUTES.discoverAiTools, id: "discoverAiTools", icon: "ai-tools", requires: MEMBER },
          { to: ROUTES.discoverServiceBundles, id: "discoverServiceBundles", icon: "bundles", requires: MEMBER },
        ],
      },
      {
        to: ROUTES.installedPlugins,
        id: "installed",
        icon: "installed",
        requires: MEMBER,
        match: "/marketplace/installed",
        tabs: [
          { to: ROUTES.installedPlugins, id: "installedPlugins", icon: "plugins", requires: MEMBER },
          { to: ROUTES.installedAiTools, id: "installedAiTools", icon: "ai-tools", requires: MEMBER },
          { to: ROUTES.installedServiceBundles, id: "installedServiceBundles", icon: "bundles", requires: MEMBER },
        ],
      },
      {
        to: ROUTES.publishSubmissions,
        id: "publish",
        icon: "submit",
        requires: MEMBER,
        match: "/marketplace/publish",
        tabs: [
          { to: ROUTES.publishSubmissions, id: "submissions", icon: "submit", requires: MEMBER },
          { to: ROUTES.publishSubmissionReview, id: "submissionReview", icon: "review", requires: PLATFORM_ADMIN },
        ],
      },
    ],
  },
  {
    // What every member may look at (read-only for most): the models they can
    // use and the platform's health.
    id: "ai",
    items: [
      { to: "/platform", id: "models", icon: "models", end: true, requires: MEMBER },
      { to: "/platform/status", id: "status", icon: "status", requires: MEMBER },
    ],
  },
  {
    id: "team",
    items: [{ to: "/platform/teams", id: "teams", icon: "teams", requires: MEMBER }],
  },
  {
    // Personal settings live together: profile, voice, your own licenses.
    id: "account",
    items: [
      { to: "/settings", id: "account", icon: "settings", end: true, requires: MEMBER },
      { to: "/platform/voice", id: "voice", icon: "voice", requires: MEMBER },
      { to: ROUTES.licenses, id: "licenses", icon: "licenses", requires: MEMBER },
    ],
  },
  {
    // Running the organization: people, AI providers, public chatbots, plan.
    id: "organization",
    admin: true,
    items: [
      { to: "/organization", id: "orgOverview", icon: "org", end: true, requires: "org.settings.manage" },
      { to: ORG_USERS_PATH, id: "orgUsers", icon: "users", requires: "org.members.manage" },
      { to: "/rag/public-chat", id: "publicChat", icon: "ask", requires: "org.chatbots.manage" },
      { to: "/platform/providers", id: "providers", icon: "globe", requires: "org.ai.manage" },
      { to: ROUTES.billing, id: "billing", icon: "billing", end: true, requires: "org.billing.view" },
      { to: "/audit", id: "audit", icon: "audit", requires: "org.audit.view" },
    ],
  },
  {
    // Operating the installation itself ("installation", not "instance").
    id: "platform",
    admin: true,
    items: [
      { to: "/organizations", id: "allOrganizations", icon: "org", requires: PLATFORM_ADMIN },
      { to: "/platform/users", id: "allUsers", icon: "users", requires: PLATFORM_ADMIN },
      { to: "/platform/backups", id: "backups", icon: "backups", requires: PLATFORM_ADMIN },
      { to: ROUTES.sources, id: "sources", icon: "sources", match: ROUTES.sources, requires: PLATFORM_ADMIN },
    ],
  },
];

/** The navigation in one language: the model with each entry's copy filled
 * from that catalog. */
export function localizeNav(messages: Messages): NavSection[] {
  const leaf = <T extends NavLeafDef>(def: T): Omit<T, "id"> & NavLeaf => {
    const { id, ...rest } = def;
    const copy: NavCopy = messages.nav.items[id];
    return {
      ...rest,
      label: copy.label,
      ...(copy.title !== undefined ? { title: copy.title } : {}),
      ...(copy.description !== undefined ? { description: copy.description } : {}),
      ...(copy.keywords !== undefined ? { keywords: copy.keywords } : {}),
    };
  };
  return NAV_MODEL.map((section) => ({
    ...(section.id ? { label: messages.nav.sections[section.id] } : {}),
    ...(section.admin ? { admin: true } : {}),
    items: section.items.map((item) => {
      const { tabs, ...entry } = item;
      return tabs ? { ...leaf(entry), tabs: tabs.map(leaf) } : leaf(entry);
    }),
  }));
}

/** The navigation in English: what the tests and the page titles are held to.
 * Components use useNavSections(), which follows the active language. */
export const NAV_SECTIONS: NavSection[] = localizeNav(en);

/** May this caller see this leaf (sidebar row, tab or palette entry)? */
export function leafVisible(leaf: NavLeaf, access: Access): boolean {
  return allows(access, leaf.requires);
}

/** The entry as this caller should see it: its tabs filtered to the visible
 * ones and its link pointed at the first of those, or null when nothing in
 * it is visible. The one place Sidebar and PageTabs take gating from. */
export function visibleEntry(entry: NavEntry, access: Access): NavEntry | null {
  if (!leafVisible(entry, access)) return null;
  if (!entry.tabs) return entry;
  const tabs = entry.tabs.filter((t) => leafVisible(t, access));
  if (tabs.length === 0) return null;
  return { ...entry, to: tabs[0].to, tabs };
}

/** The sections as this caller should see them: hidden entries dropped, and
 * sections left with nothing dropped too (no empty headings). */
export function visibleSections(sections: NavSection[], access: Access): NavSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items
        .map((item) => visibleEntry(item, access))
        .filter((item): item is NavEntry => item !== null),
    }))
    .filter((section) => section.items.length > 0);
}

/** Does `pathname` sit under `prefix` (exact, or a `prefix/…` descendant)? */
function underPrefix(prefix: string, pathname: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

/** Is `pathname` covered by this entry (for sidebar active state)? */
export function entryIsActive(entry: NavEntry, pathname: string): boolean {
  if (entry.match) {
    const prefixes = Array.isArray(entry.match) ? entry.match : [entry.match];
    return prefixes.some((p) => underPrefix(p, pathname));
  }
  if (entry.end) return pathname === entry.to;
  return underPrefix(entry.to, pathname);
}

/** The tab group (if any) a path belongs to — used by PageTabs to render the
 * in-page sub-navigation (Discover / Installed / Publish, Billing & licenses,
 * Knowledge Graph). Tabs are unfiltered; PageTabs applies visibleEntry. */
export function tabGroupForPath(
  pathname: string,
  sections: NavSection[] = NAV_SECTIONS,
): NavEntry | null {
  for (const section of sections) {
    for (const item of section.items) {
      if (item.tabs && item.match) {
        const prefixes = Array.isArray(item.match) ? item.match : [item.match];
        if (prefixes.some((p) => underPrefix(p, pathname))) {
          return item;
        }
      }
    }
  }
  return null;
}

/** Where a path sits in the navigation, for the breadcrumb trail: its
 * section (unlabelled for the top group), its entry and, on a grouped page,
 * the tab. Null off the menu (home, sign-in pages, an unknown path). Ungated:
 * the trail describes the page, and route guards decide who may see it. */
export interface NavTrail {
  section?: string;
  entry: NavEntry;
  tab?: NavLeaf;
}

export function navTrailForPath(pathname: string, sections: NavSection[]): NavTrail | null {
  if (pathname === "/") return null;
  for (const section of sections) {
    for (const entry of section.items) {
      if (!entryIsActive(entry, pathname)) continue;
      const tab = entry.tabs?.find((t) =>
        t.end ? pathname === t.to : underPrefix(t.to, pathname),
      );
      return { ...(section.label ? { section: section.label } : {}), entry, ...(tab ? { tab } : {}) };
    }
  }
  return null;
}

/** Flat list of every jump-to destination for the command palette — expands
 * grouped entries into their individual tabs so "Installed plugins" is directly
 * reachable, and drops the group parent (its route equals the first tab). A
 * tab's palette label is its page title, so the palette, the page heading and
 * the tab strip all say the same thing. */
export interface NavDestination extends NavLeaf {
  group: string;
}

/** Every palette destination of `sections`, labelled from `messages`. */
export function navDestinations(
  sections: NavSection[],
  messages: Messages,
): NavDestination[] {
  return sections.flatMap((section) => {
    const group = section.label ?? messages.nav.sections.overview;
    return section.items.flatMap((item): NavDestination[] => {
      if (item.tabs) {
        return item.tabs.map((tab) => ({
          ...tab,
          label:
            tab.title ??
            messages.nav.tabInGroup.replace("{group}", item.label).replace("{tab}", tab.label),
          group,
          keywords: `${item.label} ${item.keywords ?? ""} ${tab.keywords ?? ""}`,
        }));
      }
      return [{ ...item, label: item.title ?? item.label, group }];
    });
  });
}

export const NAV_DESTINATIONS: NavDestination[] = navDestinations(NAV_SECTIONS, en);

/** The navigation and palette destinations in the active language. */
export function useNav(): { sections: NavSection[]; destinations: NavDestination[] } {
  const { messages } = useI18n();
  return useMemo(() => {
    const sections = localizeNav(messages);
    return { sections, destinations: navDestinations(sections, messages) };
  }, [messages]);
}
