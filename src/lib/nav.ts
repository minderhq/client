import type { IconName } from "../components/Icon";

/** A navigable destination (a real route). */
export interface NavLeaf {
  to: string;
  label: string;
  icon: IconName;
  /** NavLink `end` — match this route exactly (index routes like /rag). */
  end?: boolean;
  /** Hidden for non-admins (the destination 403s them anyway). */
  adminOnly?: boolean;
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
   * duplication that made the old nav twice as long and twice as confusing. */
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
 * short description on every entry, and single entries for the plugin / tool /
 * bundle families (their Available/Installed/… pages become in-page tabs).
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
    label: "Marketplace",
    items: [
      {
        to: "/plugins/available",
        label: "Plugins",
        icon: "plugins",
        match: "/plugins",
        description: "Browse, install & manage data plugins",
        keywords: "marketplace catalog install extensions",
        tabs: [
          { to: "/plugins/available", label: "Browse", icon: "available-plugins", end: true, description: "The plugin catalog" },
          { to: "/plugins/installed", label: "Installed", icon: "installed", description: "Plugins you've installed" },
          { to: "/plugins/submissions", label: "Submit", icon: "submit", description: "Publish your own plugin" },
          { to: "/plugins/licenses", label: "Licenses", icon: "licenses", description: "Your plugin license tiers" },
          { to: "/plugins/review", label: "Review Queue", icon: "review", adminOnly: true, description: "Approve submitted plugins" },
        ],
      },
      {
        to: "/ai-tools/available",
        label: "AI Tools",
        icon: "ai-tools",
        match: "/ai-tools",
        description: "Function-calling tools the assistant can use",
        keywords: "function calling ollama actions",
        tabs: [
          { to: "/ai-tools/available", label: "Browse", icon: "ai-tools", end: true, description: "The tool catalog" },
          { to: "/ai-tools/installed", label: "Installed", icon: "installed", description: "Tools callable right now" },
        ],
      },
    ],
  },
  {
    label: "Platform",
    items: [
      { to: "/platform", label: "Models", icon: "models", end: true, description: "Local LLMs (Ollama): pull, test, remove", keywords: "ollama llm pull download" },
      { to: "/platform/voice", label: "Voice", icon: "voice", description: "Text-to-speech & speech-to-text", keywords: "tts stt speech piper transcribe" },
      {
        to: "/bundles/available",
        label: "Bundles",
        icon: "bundles",
        match: "/bundles",
        description: "Turn capability groups (services) on or off",
        keywords: "services capabilities enable monitoring",
        tabs: [
          { to: "/bundles/available", label: "Browse", icon: "bundles", end: true, description: "Capability bundles you can enable" },
          { to: "/bundles/installed", label: "Installed", icon: "installed", description: "Bundles currently turned on" },
        ],
      },
      { to: "/platform/backups", label: "Backups", icon: "backups", description: "Snapshot & restore the platform", keywords: "restore archive snapshot" },
      { to: "/platform/status", label: "Status", icon: "status", description: "Service health & recent logs", keywords: "health services uptime logs" },
    ],
  },
  {
    label: "Organization",
    items: [
      { to: "/organization", label: "Overview", icon: "org", end: true, description: "Your org, its members & switching", keywords: "organization tenant workspace switch members" },
      { to: "/billing", label: "Billing", icon: "billing", description: "Your plan, subscription & upgrades", keywords: "subscription plan upgrade payment tier pricing invoice" },
      { to: "/platform/teams", label: "Teams", icon: "teams", description: "Group people & share resources", keywords: "groups members sharing collaborate" },
      { to: "/organizations", label: "All Organizations", icon: "org", adminOnly: true, description: "Every org on the instance + provisioning (admin)", keywords: "organizations tenants provision create admin" },
      { to: "/platform/users", label: "All Users", icon: "users", adminOnly: true, description: "Instance-wide accounts & roles (admin) — distinct from this org's members above", keywords: "users accounts roles admin people members" },
      { to: "/audit", label: "Audit Log", icon: "audit", adminOnly: true, description: "Append-only record of privileged actions (admin)", keywords: "audit log security history who did what siem" },
    ],
  },
];

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
 * in-page sub-navigation for the plugin / tool / bundle families. */
export function tabGroupForPath(
  pathname: string,
): { label: string; tabs: NavLeaf[] } | null {
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (item.tabs && item.match) {
        const prefixes = Array.isArray(item.match) ? item.match : [item.match];
        if (prefixes.some((p) => underPrefix(p, pathname))) {
          return { label: item.label, tabs: item.tabs };
        }
      }
    }
  }
  return null;
}

/** Flat list of every jump-to destination for the command palette — expands
 * grouped entries into their individual tabs so "Installed plugins" is directly
 * reachable, and drops the group parent (its route equals the first tab). */
export interface NavDestination extends NavLeaf {
  group: string;
}

export const NAV_DESTINATIONS: NavDestination[] = NAV_SECTIONS.flatMap((section) => {
  const group = section.label ?? "Overview";
  return section.items.flatMap((item): NavDestination[] => {
    if (item.tabs) {
      return item.tabs.map((tab) => ({
        ...tab,
        label: `${item.label}: ${tab.label}`,
        group,
        keywords: `${item.label} ${item.keywords ?? ""} ${tab.keywords ?? ""}`,
      }));
    }
    return [{ ...item, group }];
  });
});
