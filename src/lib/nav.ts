import { useMemo } from "react";

import type { IconName } from "../components/Icon";
import { en, useI18n, type Messages } from "../i18n";
import { REQUEST_INBOX_REQUIRES } from "./accessRequests";
import { type PlanTier, UPGRADE_TIERS } from "./billing";
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
  /** A plan feature (client#126 Q6.3): the tab stays in place for every
   * plan and carries a plan badge while the org's plan lacks `feature` (a
   * limit key). Only for admin settings tabs, never the main nav. */
  plan?: { feature: string; tier: PlanTier };
}

/** A sidebar entry. Most are plain links; a few own several closely-related
 * sub-pages (the old "Available / Installed / …" split) and show as ONE
 * sidebar item, exposing the rest as in-page tabs (see PageTabs). */
export interface NavEntry extends NavLeaf {
  /** Pathname prefix(es) that keep this entry highlighted for any of its
   * routes, detail pages included (e.g. "/organization/people" for a
   * person's page). Without it, an entry with tabs is active on any of its
   * tabs' pages, so tabs that DON'T share a prefix (Chat: /ask and
   * /rag/conversations) still form one entry. */
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
 * The app's information architecture (client#126 menu decision): one panel
 * for everyone, in three layers named for what the user is doing: Use (Home,
 * Chat), Build (Knowledge, Assistants, Discover) and Me (My team, My account).
 * The administration areas sit below a divider and appear only to callers
 * who hold their permissions: Organization (the tenant) and Platform (the
 * installation, always apart from Organization). Each row names the
 * permission it needs; the sidebar, tabs and palette filter through useCan,
 * never through role names. The main menu never changes by plan.
 *
 * A page that moved keeps its route guard: the menu entry decides who is
 * shown the page, the guard (App.tsx) who may open it. The Platform pages
 * Status & logs, Local models and Modules stay readable by every member at
 * their URL (the status page is public); only their menu rows are the
 * Platform Admin's.
 *
 * Labels, page titles, descriptions and palette keywords are not here: each
 * entry's `id` names its copy in the message catalogs (`nav.items.<id>`), so
 * the menu follows the active language (see localizeNav).
 */
const NAV_MODEL: NavSectionDef[] = [
  {
    id: "use",
    items: [
      { to: "/", id: "home", icon: "home", end: true, requires: MEMBER },
      {
        to: "/ask",
        id: "chat",
        icon: "ask",
        requires: MEMBER,
        tabs: [
          { to: "/ask", id: "ask", icon: "ask", requires: MEMBER },
          { to: ROUTES.chatHistory, id: "conversations", icon: "conversations", requires: MEMBER },
        ],
      },
    ],
  },
  {
    id: "build",
    items: [
      {
        // Knowledge bases and the knowledge graph; the member's own taxonomy
        // review queue is a tab of it (every member reviews the suggestions
        // on their own entities). Entity merges are Organization › Knowledge
        // quality.
        to: "/rag",
        id: "knowledge",
        icon: "knowledge-bases",
        requires: MEMBER,
        tabs: [
          { to: "/rag", id: "knowledgeBases", icon: "knowledge-bases", end: true, requires: MEMBER },
          { to: "/rag/graph", id: "knowledgeGraph", icon: "graph", requires: MEMBER },
          { to: "/rag/taxonomy-review", id: "taxonomyReview", icon: "taxonomy", requires: MEMBER },
        ],
      },
      { to: "/rag/pipelines", id: "pipelines", icon: "pipelines", requires: MEMBER },
      {
        // Discover: ONE catalog screen for plugins, with what is installed as
        // a view of it. A plugin's source is a filter and badge. AI tools are
        // a facet of a plugin (their pages stay reachable from the plugin
        // pages, without a row of their own); modules are Platform-only.
        to: ROUTES.discoverPlugins,
        id: "discover",
        icon: "available-plugins",
        requires: MEMBER,
        match: "/marketplace",
        tabs: [
          { to: ROUTES.discoverPlugins, id: "discoverPlugins", icon: "plugins", requires: MEMBER },
          { to: ROUTES.installedPlugins, id: "installedPlugins", icon: "installed", requires: MEMBER },
        ],
      },
    ],
  },
  {
    id: "me",
    items: [
      // Every member's: their team, or where they ask to join one.
      { to: ROUTES.myTeam, id: "myTeam", icon: "teams", requires: MEMBER },
      {
        to: ROUTES.account,
        id: "account",
        icon: "settings",
        requires: MEMBER,
        tabs: [
          { to: ROUTES.account, id: "profile", icon: "user", end: true, requires: MEMBER },
          { to: ROUTES.voice, id: "voice", icon: "voice", requires: MEMBER },
          // What the caller asked for; the decision inbox is Organization ›
          // People › Requests.
          { to: ROUTES.myRequests, id: "myRequests", icon: "send", requires: MEMBER },
        ],
      },
    ],
  },
  {
    // Running the organization (the tenant).
    id: "organization",
    admin: true,
    items: [
      { to: "/organization", id: "orgOverview", icon: "org", end: true, requires: "org.settings.manage" },
      {
        // Organization › People: members, invites, the requests inbox and the
        // allowed email domains; each person's page sits under it too.
        to: ROUTES.people,
        id: "orgUsers",
        icon: "users",
        requires: "org.members.manage",
        match: ROUTES.people,
        tabs: [
          { to: ROUTES.people, id: "people", icon: "users", end: true, requires: "org.members.manage" },
          { to: ROUTES.peopleInvites, id: "peopleInvites", icon: "mail", requires: "org.members.manage" },
          // One inbox for every request kind.
          { to: ROUTES.requests, id: "requests", icon: "send", requires: REQUEST_INBOX_REQUIRES },
          {
            to: ROUTES.peopleDomains,
            id: "peopleDomains",
            icon: "globe",
            requires: "org.settings.manage",
            plan: { feature: "policy.allowed_email_domains", tier: UPGRADE_TIERS[0] },
          },
        ],
      },
      // Organization › Teams: every team of the org, created and managed here.
      { to: ROUTES.orgTeams, id: "teams", icon: "teams", requires: "org.teams.manage" },
      {
        // Organization › AI: the org's providers and its default model per task.
        to: ROUTES.orgAi,
        id: "orgAi",
        icon: "models",
        requires: "org.ai.manage",
        match: ROUTES.orgAi,
        tabs: [
          { to: ROUTES.orgAi, id: "orgAiProviders", icon: "globe", end: true, requires: "org.ai.manage" },
          { to: ROUTES.orgAiDefaults, id: "orgAiDefaults", icon: "models", requires: "org.ai.manage" },
        ],
      },
      // Organization › Plugins: what is installed for the whole org. The
      // marketplace's install gate is org.settings.manage, so this is too.
      { to: ROUTES.orgPlugins, id: "orgPlugins", icon: "plugins", requires: "org.settings.manage" },
      {
        to: ROUTES.chatbots,
        id: "publicChat",
        icon: "ask",
        match: ROUTES.chatbots,
        requires: "org.chatbots.manage",
      },
      // The entity-merge review. Its page and API serve any member for the
      // candidates they own; the row is the org admin's (org.settings.manage)
      // so Organization stays an admin area.
      { to: ROUTES.knowledgeQuality, id: "knowledgeQuality", icon: "merge", requires: "org.settings.manage" },
      {
        // Organization › Security › Audit log: always the active org's log.
        to: ROUTES.orgAudit,
        id: "security",
        icon: "lock",
        requires: "org.audit.view",
        match: "/organization/security",
        tabs: [{ to: ROUTES.orgAudit, id: "audit", icon: "audit", requires: "org.audit.view" }],
      },
      { to: ROUTES.billing, id: "billing", icon: "billing", requires: "org.billing.view" },
    ],
  },
  {
    // Operating the installation itself ("installation", not "instance").
    id: "platform",
    admin: true,
    items: [
      { to: ROUTES.status, id: "status", icon: "status", requires: PLATFORM_ADMIN },
      { to: ROUTES.models, id: "models", icon: "models", requires: PLATFORM_ADMIN },
      {
        // Modules (service bundles): local runtime switches, never in Discover.
        to: ROUTES.modules,
        id: "modules",
        icon: "bundles",
        requires: PLATFORM_ADMIN,
        match: ROUTES.modules,
        tabs: [
          { to: ROUTES.modules, id: "modulesDiscover", icon: "available-plugins", end: true, requires: PLATFORM_ADMIN },
          { to: ROUTES.installedModules, id: "modulesInstalled", icon: "installed", requires: PLATFORM_ADMIN },
        ],
      },
      { to: ROUTES.allOrganizations, id: "allOrganizations", icon: "org", requires: PLATFORM_ADMIN },
      { to: ROUTES.allUsers, id: "allUsers", icon: "users", requires: PLATFORM_ADMIN },
      { to: ROUTES.sources, id: "sources", icon: "sources", match: ROUTES.sources, requires: PLATFORM_ADMIN },
      { to: ROUTES.backups, id: "backups", icon: "backups", requires: PLATFORM_ADMIN },
      { to: ROUTES.platformAudit, id: "platformAudit", icon: "audit", requires: PLATFORM_ADMIN },
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
  if (entry.tabs) return entry.tabs.some((t) => leafIsActive(t, pathname));
  if (entry.end) return pathname === entry.to;
  return underPrefix(entry.to, pathname);
}

/** Is `pathname` this leaf's page (or, without `end`, under it)? */
function leafIsActive(leaf: NavLeaf, pathname: string): boolean {
  return leaf.end ? pathname === leaf.to : underPrefix(leaf.to, pathname);
}

/** The tab group (if any) a path belongs to — used by PageTabs to render the
 * in-page sub-navigation (Chat, Knowledge, Discover, My account, People,
 * Modules…). Tabs are unfiltered; PageTabs applies visibleEntry. */
export function tabGroupForPath(
  pathname: string,
  sections: NavSection[] = NAV_SECTIONS,
): NavEntry | null {
  for (const section of sections) {
    for (const item of section.items) {
      if (item.tabs && entryIsActive(item, pathname)) return item;
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
      const tab = entry.tabs?.find((t) => leafIsActive(t, pathname));
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
