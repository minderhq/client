import { useMemo } from "react";

import type { IconName } from "../components/Icon";
import { en, useI18n, type Messages } from "../i18n";
import { ORG_USERS_PATH } from "./orgs";
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
  /** Hidden for non-admins (the destination 403s them anyway). */
  adminOnly?: boolean;
  /** Shown only to a Platform Admin: the installation-wide, cross-org views
   * the API serves to Platform Admins alone. */
  platformAdminOnly?: boolean;
  /** Shown only when the caller may view this org's billing (#64). */
  requiresBilling?: boolean;
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
  items: NavEntryDef[];
}

/**
 * The app's information architecture, grouped by what the user is trying to DO
 * rather than by which backend service powers it. Plain-language labels, a
 * short description on every entry, and one sidebar entry per task: the
 * Marketplace is Discover / Installed / Publish, each showing its item types
 * (plugins, AI tools, service bundles) as in-page tabs (#2197).
 *
 * "Organization" is intentionally its own section: member/team management —
 * and the org/workspace administration coming next — belong together and read
 * as account administration, distinct from operating the platform itself.
 *
 * Labels, page titles, descriptions and palette keywords are not here: each
 * entry's `id` names its copy in the message catalogs (`nav.items.<id>`), so
 * the menu follows the active language (see localizeNav).
 */
const NAV_MODEL: NavSectionDef[] = [
  {
    items: [
      { to: "/", id: "home", icon: "home", end: true },
      { to: "/ask", id: "ask", icon: "ask" },
    ],
  },
  {
    id: "knowledge",
    items: [
      { to: "/rag", id: "knowledgeBases", icon: "knowledge-bases", end: true },
      { to: "/rag/pipelines", id: "pipelines", icon: "pipelines" },
      { to: "/rag/conversations", id: "conversations", icon: "conversations" },
      { to: "/rag/public-chat", id: "publicChat", icon: "ask", adminOnly: true },
      // Graph / Taxonomy Review / Entity Merge Review are advanced surfaces a
      // first-timer has no data for — nested under one "Knowledge Graph" entry
      // as in-page tabs (#1230) so top-level Knowledge is just the golden path
      // (KB · Pipelines · Conversations). They don't share a path prefix, hence
      // the match[] array.
      {
        to: "/rag/graph",
        id: "knowledgeGraph",
        icon: "graph",
        match: ["/rag/graph", "/rag/taxonomy-review", "/rag/entity-merges"],
        tabs: [
          { to: "/rag/graph", id: "graph", icon: "graph", end: true },
          { to: "/rag/taxonomy-review", id: "taxonomyReview", icon: "taxonomy" },
          { to: "/rag/entity-merges", id: "entityMerges", icon: "merge" },
        ],
      },
    ],
  },
  {
    // Marketplace (#2197, epic #2192 decision A): ONE Discover catalog, ONE
    // Installed view, ONE Publish area, instead of separate Plugins / AI Tools /
    // Bundles stores. The item type is the tab; a plugin's source (first-party,
    // private git, submitted, later MindHub) is a filter and badge on Discover.
    id: "marketplace",
    items: [
      {
        to: ROUTES.discoverPlugins,
        id: "discover",
        icon: "available-plugins",
        match: "/marketplace/discover",
        tabs: [
          { to: ROUTES.discoverPlugins, id: "discoverPlugins", icon: "plugins" },
          { to: ROUTES.discoverAiTools, id: "discoverAiTools", icon: "ai-tools" },
          { to: ROUTES.discoverServiceBundles, id: "discoverServiceBundles", icon: "bundles" },
        ],
      },
      {
        to: ROUTES.installedPlugins,
        id: "installed",
        icon: "installed",
        match: "/marketplace/installed",
        tabs: [
          { to: ROUTES.installedPlugins, id: "installedPlugins", icon: "plugins" },
          { to: ROUTES.installedAiTools, id: "installedAiTools", icon: "ai-tools" },
          { to: ROUTES.installedServiceBundles, id: "installedServiceBundles", icon: "bundles" },
        ],
      },
      {
        to: ROUTES.publishSubmissions,
        id: "publish",
        icon: "submit",
        match: "/marketplace/publish",
        tabs: [
          { to: ROUTES.publishSubmissions, id: "submissions", icon: "submit" },
          { to: ROUTES.publishSubmissionReview, id: "submissionReview", icon: "review", adminOnly: true },
        ],
      },
    ],
  },
  {
    id: "platform",
    items: [
      { to: "/platform", id: "models", icon: "models", end: true },
      { to: "/platform/providers", id: "providers", icon: "globe" },
      { to: "/platform/voice", id: "voice", icon: "voice" },
      { to: "/platform/backups", id: "backups", icon: "backups" },
      { to: "/platform/status", id: "status", icon: "status" },
    ],
  },
  {
    id: "organization",
    items: [
      { to: "/organization", id: "orgOverview", icon: "org", end: true },
      { to: ORG_USERS_PATH, id: "orgUsers", icon: "users" },
      {
        to: ROUTES.billing,
        id: "billingAndLicenses",
        icon: "billing",
        match: ROUTES.billing,
        tabs: [
          // Billing keeps its #64 gate; Licenses is open to every signed-in
          // user, so the entry stays visible (linking to Licenses) without it.
          { to: ROUTES.billing, id: "billing", icon: "billing", end: true, requiresBilling: true },
          { to: ROUTES.licenses, id: "licenses", icon: "licenses" },
        ],
      },
      { to: "/platform/teams", id: "teams", icon: "teams" },
      { to: "/organizations", id: "allOrganizations", icon: "org", adminOnly: true },
      { to: "/platform/users", id: "allUsers", icon: "users", platformAdminOnly: true },
      { to: "/audit", id: "audit", icon: "audit", adminOnly: true },
    ],
  },
  {
    // Operator-only configuration of the installation itself (#2192 decision
    // A). Today: the read-only plugin source repositories, plus a placeholder
    // for the MindHub connection (#2201). Gated on role === "admin" like every
    // other operator item until #2200 refines the roles.
    // "Installation settings", not "Settings": the user menu's Settings is
    // your own account; this is the installation's (glossary: "installation",
    // not "instance", for the deployment).
    id: "installationSettings",
    items: [
      { to: ROUTES.sources, id: "sources", icon: "sources", match: ROUTES.sources, adminOnly: true },
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
    items: section.items.map((item) => {
      const { tabs, ...entry } = item;
      return tabs ? { ...leaf(entry), tabs: tabs.map(leaf) } : leaf(entry);
    }),
  }));
}

/** The navigation in English: what the tests and the page titles are held to.
 * Components use useNavSections(), which follows the active language. */
export const NAV_SECTIONS: NavSection[] = localizeNav(en);

/** Who is looking: the gates nav items use today. */
export interface NavAccess {
  isAdmin: boolean;
  /** A Platform Admin (the `is_platform_admin` token claim). */
  isPlatformAdmin: boolean;
  /** May view this org's billing (#64, useBillingAccess). */
  billing: boolean;
}

/** May this caller see this leaf (sidebar row, tab or palette entry)? */
export function leafVisible(leaf: NavLeaf, access: NavAccess): boolean {
  return (
    (!leaf.adminOnly || access.isAdmin) &&
    (!leaf.platformAdminOnly || access.isPlatformAdmin) &&
    (!leaf.requiresBilling || access.billing)
  );
}

/** The entry as this caller should see it: its tabs filtered to the visible
 * ones and its link pointed at the first of those, or null when nothing in
 * it is visible. The one place Sidebar and PageTabs take role gating from. */
export function visibleEntry(entry: NavEntry, access: NavAccess): NavEntry | null {
  if (!leafVisible(entry, access)) return null;
  if (!entry.tabs) return entry;
  const tabs = entry.tabs.filter((t) => leafVisible(t, access));
  if (tabs.length === 0) return null;
  return { ...entry, to: tabs[0].to, tabs };
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
      return [{ ...item, group }];
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
