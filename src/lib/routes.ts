/**
 * Canonical routes (client#126 menu decision), plus every older URL that must
 * keep working.
 *
 * One vocabulary, used for the route, the nav label, the tab label, the page
 * title and the command-palette entry alike. The menu has three layers for
 * everyone (Use / Build / Me) and, below a divider, the administration areas
 * Organization (the tenant) and Platform (the installation):
 *
 *   Build › Discover           /marketplace/discover/plugins, /marketplace/installed/plugins
 *   Me › My account            /account, /account/voice, /account/requests
 *   Me › My team               /team
 *   Organization › People      /organization/people(/invites|/requests|/domains|/:userId)
 *   Organization › Teams       /organization/teams
 *   Organization › Website chatbots  /organization/chatbots
 *   Organization › Knowledge quality /organization/knowledge-quality
 *   Organization › Security    /organization/security/audit (the active org)
 *   Organization › Plan & billing    /organization/billing
 *   Platform › Status & logs   /status (public, so outside /platform)
 *   Platform › Local models    /platform/models
 *   Platform › Modules         /platform/modules(/installed)
 *   Platform › All organizations     /platform/organizations
 *   Platform › MindHub & sources     /platform/sources(/:repositoryId)
 *   Platform › Platform audit log    /platform/audit (installation-wide)
 *
 * "Module" (a service bundle: a runtime grouping of services the bundle
 * reconciler turns on and off) is Platform-only and never in Discover. AI tools
 * are a facet of a plugin, not a catalog entry: their pages stay reachable
 * from the plugin pages but have no menu row.
 *
 * Every route listed here is referenced from nav.ts, App.tsx and the pages, so
 * a rename happens in exactly one place.
 */
export const ROUTES = {
  discoverPlugins: "/marketplace/discover/plugins",
  discoverAiTools: "/marketplace/discover/ai-tools",
  installedPlugins: "/marketplace/installed/plugins",
  installedAiTools: "/marketplace/installed/ai-tools",
  chatHistory: "/rag/conversations",
  account: "/account",
  voice: "/account/voice",
  myRequests: "/account/requests",
  myTeam: "/team",
  people: "/organization/people",
  peopleInvites: "/organization/people/invites",
  requests: "/organization/people/requests",
  peopleDomains: "/organization/people/domains",
  orgTeams: "/organization/teams",
  orgAi: "/organization/ai",
  orgAiDefaults: "/organization/ai/defaults",
  orgPlugins: "/organization/plugins",
  chatbots: "/organization/chatbots",
  knowledgeQuality: "/organization/knowledge-quality",
  orgAudit: "/organization/security/audit",
  billing: "/organization/billing",
  status: "/status",
  models: "/platform/models",
  modules: "/platform/modules",
  installedModules: "/platform/modules/installed",
  allOrganizations: "/platform/organizations",
  allUsers: "/platform/users",
  sources: "/platform/sources",
  backups: "/platform/backups",
  platformAudit: "/platform/audit",
} as const;

/** One website chatbot's conversations, or one conversation of it. */
export function chatbotConversationsRoute(endpointId: number | string, sessionId?: string): string {
  const base = `${ROUTES.chatbots}/${endpointId}/conversations`;
  return sessionId === undefined ? base : `${base}/${encodeURIComponent(sessionId)}`;
}

/** One member's person page (Organization › People). */
export function personRoute(userId: number | string): string {
  return `${ROUTES.people}/${userId}`;
}

/** The detail view of one plugin source repository. */
export function sourceRepositoryRoute(repositoryId: string): string {
  return `${ROUTES.sources}/${encodeURIComponent(repositoryId)}`;
}

/** A path that redirects elsewhere. `to` may use the same `:params` as `from`;
 * the query string and hash are always carried over (e.g. `?source=`, `?q=`). */
export interface Redirect {
  from: string;
  to: string;
}

/** Section indexes: a bare section path lands on its first tab. */
export const SECTION_REDIRECTS: Redirect[] = [
  { from: "/marketplace", to: ROUTES.discoverPlugins },
  { from: "/marketplace/discover", to: ROUTES.discoverPlugins },
  { from: "/marketplace/installed", to: ROUTES.installedPlugins },
  { from: "/organization/security", to: ROUTES.orgAudit },
];

/** Every URL the console used to serve, mapped to where that page lives now,
 * so bookmarks and docs links keep working. Never delete an entry: old links
 * live on in browser history, docs and chat logs long after a rename. */
export const LEGACY_REDIRECTS: Redirect[] = [
  // Pre-restructure flat routes.
  { from: "/knowledge-bases", to: "/rag" },
  { from: "/rag-pipelines", to: "/rag/pipelines" },
  { from: "/plugin-config", to: ROUTES.installedPlugins },
  { from: "/marketplace/plugins", to: ROUTES.discoverPlugins },
  { from: "/marketplace/plugins/available", to: ROUTES.discoverPlugins },
  { from: "/marketplace/plugins/installed", to: ROUTES.installedPlugins },
  { from: "/marketplace/plugins/ai-tools", to: ROUTES.discoverAiTools },
  { from: "/marketplace/bundles", to: ROUTES.modules },
  { from: "/platform/bundles", to: ROUTES.modules },
  // The "Plugins" family (before #2197).
  { from: "/plugins", to: ROUTES.discoverPlugins },
  { from: "/plugins/available", to: ROUTES.discoverPlugins },
  { from: "/plugins/installed", to: ROUTES.installedPlugins },
  { from: "/plugins/config", to: ROUTES.installedPlugins },
  { from: "/plugins/ai-tools", to: ROUTES.discoverAiTools },
  { from: "/plugins/submissions", to: ROUTES.discoverPlugins },
  { from: "/plugins/review", to: ROUTES.discoverPlugins },
  { from: "/plugins/licenses", to: ROUTES.billing },
  { from: "/plugins/sources", to: ROUTES.sources },
  { from: "/plugins/sources/:repositoryId", to: `${ROUTES.sources}/:repositoryId` },
  // The "AI Tools" family (before #2197).
  { from: "/ai-tools", to: ROUTES.discoverAiTools },
  { from: "/ai-tools/available", to: ROUTES.discoverAiTools },
  { from: "/ai-tools/installed", to: ROUTES.installedAiTools },
  // The "Bundles" family (before #2197).
  { from: "/bundles", to: ROUTES.modules },
  { from: "/bundles/available", to: ROUTES.modules },
  { from: "/bundles/installed", to: ROUTES.installedModules },
  // The org's member list before Organization › People (UX step 7).
  { from: "/organization/users", to: ROUTES.people },
  // Providers & defaults before Organization › AI (UX step 9).
  { from: "/platform/providers", to: ROUTES.orgAi },
  // The member Teams page before the Teams split (Organization › Teams for
  // admins, My team for everyone).
  { from: "/platform/teams", to: ROUTES.myTeam },
  // The menu regroup (client#126 menu decision): Organization and Platform
  // pages moved under their areas; My account under /account.
  { from: "/rag/public-chat", to: ROUTES.chatbots },
  { from: "/rag/public-chat/:endpointId/conversations", to: `${ROUTES.chatbots}/:endpointId/conversations` },
  {
    from: "/rag/public-chat/:endpointId/conversations/:sessionId",
    to: `${ROUTES.chatbots}/:endpointId/conversations/:sessionId`,
  },
  { from: "/rag/entity-merges", to: ROUTES.knowledgeQuality },
  { from: "/billing", to: ROUTES.billing },
  // Personal licenses were removed: entitlements show on Plan & billing.
  { from: "/billing/licenses", to: ROUTES.billing },
  { from: "/audit", to: ROUTES.orgAudit },
  { from: "/organizations", to: ROUTES.allOrganizations },
  { from: "/settings", to: ROUTES.account },
  { from: "/settings/sources", to: ROUTES.sources },
  { from: "/settings/sources/:repositoryId", to: `${ROUTES.sources}/:repositoryId` },
  { from: "/marketplace/discover/service-bundles", to: ROUTES.modules },
  { from: "/marketplace/installed/service-bundles", to: ROUTES.installedModules },
  // Local plugin publishing and review moved to MindHub.
  { from: "/marketplace/publish", to: ROUTES.discoverPlugins },
  { from: "/marketplace/publish/submissions", to: ROUTES.discoverPlugins },
  { from: "/marketplace/publish/submission-review", to: ROUTES.discoverPlugins },
  { from: "/platform", to: ROUTES.models },
  { from: "/platform/status", to: ROUTES.status },
  { from: "/platform/voice", to: ROUTES.voice },
];
