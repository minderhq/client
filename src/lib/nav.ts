import type { IconName } from "../components/Icon";
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
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { to: "/", label: "Home", icon: "home", end: true, description: "Your workspace at a glance", keywords: "dashboard overview start" },
      { to: "/ask", label: "Ask", icon: "ask", description: "Chat with your knowledge", keywords: "chat query question rag answer" },
    ],
  },
  {
    label: "Knowledge",
    items: [
      { to: "/rag", label: "Knowledge Bases", icon: "knowledge-bases", end: true, description: "Upload & manage your documents", keywords: "documents kb corpus upload files" },
      { to: "/rag/pipelines", label: "Pipelines", icon: "pipelines", description: "Set up question-answering over your documents", keywords: "retrieval query hyde self-rag q&a" },
      { to: "/rag/conversations", label: "Conversations", icon: "conversations", description: "Revisit your past chats", keywords: "history threads chat" },
      { to: "/rag/public-chat", label: "Public Chat", icon: "ask", adminOnly: true, description: "Publish a public chatbot over a pipeline (admin)", keywords: "public chatbot widget endpoint slug anonymous embed share rate limit" },
      // Graph / Taxonomy Review / Entity Merge Review are advanced surfaces a
      // first-timer has no data for — nested under one "Knowledge Graph" entry
      // as in-page tabs (#1230) so top-level Knowledge is just the golden path
      // (KB · Pipelines · Conversations). They don't share a path prefix, hence
      // the match[] array.
      {
        to: "/rag/graph",
        label: "Knowledge Graph",
        icon: "graph",
        match: ["/rag/graph", "/rag/taxonomy-review", "/rag/entity-merges"],
        description: "Entities, categories & merges from your documents",
        keywords: "neo4j entities relationships correlation taxonomy categories merge same_as dedup",
        tabs: [
          { to: "/rag/graph", label: "Graph", icon: "graph", end: true, description: "Entities and how they connect" },
          { to: "/rag/taxonomy-review", label: "Taxonomy Review", icon: "taxonomy", description: "Approve AI-suggested entity categories" },
          { to: "/rag/entity-merges", label: "Entity Merge Review", icon: "merge", description: "Approve cross-org SAME_AS entity links (dual-control)" },
        ],
      },
    ],
  },
  {
    // Marketplace (#2197, epic #2192 decision A): ONE Discover catalog, ONE
    // Installed view, ONE Publish area, instead of separate Plugins / AI Tools /
    // Bundles stores. The item type is the tab; a plugin's source (first-party,
    // private git, submitted, later MindHub) is a filter and badge on Discover.
    label: "Marketplace",
    items: [
      {
        to: ROUTES.discoverPlugins,
        label: "Discover",
        icon: "available-plugins",
        match: "/marketplace/discover",
        description: "Find plugins, AI tools and service bundles to add",
        keywords: "marketplace catalog browse store available install extensions",
        tabs: [
          { to: ROUTES.discoverPlugins, label: "Plugins", title: "Discover plugins", icon: "plugins", description: "The plugin catalog, filterable by source", keywords: "plugin connectors source first-party private git submitted mindhub" },
          { to: ROUTES.discoverAiTools, label: "AI tools", title: "Discover AI tools", icon: "ai-tools", description: "Every AI tool plugins offer, running or not", keywords: "ai tool function calling ollama actions" },
          { to: ROUTES.discoverServiceBundles, label: "Service bundles", title: "Discover service bundles", icon: "bundles", description: "Service bundles you can turn on", keywords: "bundle services capabilities enable monitoring inference voice" },
        ],
      },
      {
        to: ROUTES.installedPlugins,
        label: "Installed",
        icon: "installed",
        match: "/marketplace/installed",
        description: "Everything on this installation: version, health and settings",
        keywords: "marketplace running runtime enabled manage configure",
        tabs: [
          { to: ROUTES.installedPlugins, label: "Plugins", title: "Installed plugins", icon: "plugins", description: "What runs on this installation, plus your installs", keywords: "plugin running runtime version health first-party config settings enable disable uninstall" },
          { to: ROUTES.installedAiTools, label: "AI tools", title: "Installed AI tools", icon: "ai-tools", description: "AI tools the assistant can call right now", keywords: "ai tool live callable function calling" },
          { to: ROUTES.installedServiceBundles, label: "Service bundles", title: "Installed service bundles", icon: "bundles", description: "Service bundles turned on, their images, export and import", keywords: "bundle services enabled reconcile export import docker" },
        ],
      },
      {
        to: ROUTES.publishSubmissions,
        label: "Publish",
        icon: "submit",
        match: "/marketplace/publish",
        description: "Submit your own plugins; review submissions (admin)",
        keywords: "marketplace plugins publish developer author",
        tabs: [
          { to: ROUTES.publishSubmissions, label: "Submissions", title: "Plugin submissions", icon: "submit", description: "Submit a plugin and follow its review", keywords: "submit draft upload" },
          { to: ROUTES.publishSubmissionReview, label: "Submission review", title: "Submission review", icon: "review", adminOnly: true, description: "Approve or reject submitted plugins (admin)", keywords: "review queue approve reject moderation" },
        ],
      },
    ],
  },
  {
    label: "Platform",
    items: [
      { to: "/platform", label: "Models", icon: "models", end: true, description: "Local LLMs (Ollama): pull, test, remove", keywords: "ollama llm pull download" },
      { to: "/platform/providers", label: "Cloud Providers", icon: "globe", adminOnly: true, description: "Connect OpenAI-compatible or Anthropic providers (admin)", keywords: "openai anthropic cloud remote provider api key credential" },
      { to: "/platform/voice", label: "Voice", icon: "voice", description: "Text-to-speech & speech-to-text", keywords: "tts stt speech piper transcribe" },
      { to: "/platform/backups", label: "Backups", icon: "backups", description: "Snapshot & restore the platform", keywords: "restore archive snapshot" },
      { to: "/platform/status", label: "Status", icon: "status", description: "Service health & recent logs", keywords: "health services uptime logs" },
    ],
  },
  {
    label: "Organization",
    items: [
      { to: "/organization", label: "Overview", icon: "org", end: true, description: "Your org, its invites & switching", keywords: "organization tenant workspace switch invites" },
      { to: ORG_USERS_PATH, label: "Users", icon: "users", description: "This org's members: roles, suspend, remove, account resets", keywords: "users members people accounts suspend remove reset password deactivate roles" },
      {
        to: ROUTES.billing,
        label: "Billing & licenses",
        icon: "billing",
        match: ROUTES.billing,
        description: "Your plan, subscription and plugin licenses",
        keywords: "subscription plan payment license entitlement",
        tabs: [
          // Billing keeps its #64 gate; Licenses is open to every signed-in
          // user, so the entry stays visible (linking to Licenses) without it.
          { to: ROUTES.billing, label: "Billing", title: "Billing", icon: "billing", end: true, requiresBilling: true, description: "Your plan, subscription & upgrades", keywords: "subscription plan upgrade payment tier pricing invoice" },
          { to: ROUTES.licenses, label: "Licenses", title: "Plugin licenses", icon: "licenses", description: "The plugin tiers licensed to your account (display-only)", keywords: "my licenses tier plugin" },
        ],
      },
      { to: "/platform/teams", label: "Teams", icon: "teams", description: "Group people & share resources", keywords: "groups members sharing collaborate" },
      { to: "/organizations", label: "All Organizations", icon: "org", adminOnly: true, description: "Every org on the instance + provisioning (admin)", keywords: "organizations tenants provision create admin" },
      { to: "/platform/users", label: "All Users", icon: "users", platformAdminOnly: true, description: "Every account on the installation, across orgs (Platform Admin)", keywords: "users accounts roles platform admin people members instance" },
      { to: "/audit", label: "Audit Log", icon: "audit", adminOnly: true, description: "Append-only record of privileged actions (admin)", keywords: "audit log security history who did what siem" },
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
    label: "Installation settings",
    items: [
      { to: ROUTES.sources, label: "MindHub & sources", title: "MindHub & sources", icon: "sources", match: ROUTES.sources, adminOnly: true, description: "Where this installation's plugins come from (operators)", keywords: "mindhub sources plugin source repositories git private mirror connect operator platform admin" },
    ],
  },
];

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
export function tabGroupForPath(pathname: string): NavEntry | null {
  for (const section of NAV_SECTIONS) {
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

export const NAV_DESTINATIONS: NavDestination[] = NAV_SECTIONS.flatMap((section) => {
  const group = section.label ?? "Overview";
  return section.items.flatMap((item): NavDestination[] => {
    if (item.tabs) {
      return item.tabs.map((tab) => ({
        ...tab,
        label: tab.title ?? `${item.label}: ${tab.label}`,
        group,
        keywords: `${item.label} ${item.keywords ?? ""} ${tab.keywords ?? ""}`,
      }));
    }
    return [{ ...item, group }];
  });
});
