/**
 * Canonical routes for the marketplace information architecture (#2197, epic
 * #2192 decision A), plus every older URL that must keep working.
 *
 * One vocabulary, used for the route, the nav label, the tab label, the page
 * title and the command-palette entry alike:
 *
 *   Marketplace › Discover   /marketplace/discover/{plugins,ai-tools,service-bundles}
 *   Marketplace › Installed  /marketplace/installed/{plugins,ai-tools,service-bundles}
 *   Marketplace › Publish    /marketplace/publish/{submissions,submission-review}
 *   Organization › Billing & licenses   /billing, /billing/licenses
 *   Installation settings › MindHub & sources   /settings/sources(/:repositoryId)
 *
 * "Service bundle" (a runtime grouping of services the bundle reconciler turns
 * on and off) is kept distinct from plugins in both the label and the path.
 * "Submission review" is the glossary term for moderating a submitted listing.
 *
 * Every route listed here is referenced from nav.ts, App.tsx and the pages, so
 * a rename happens in exactly one place.
 */
export const ROUTES = {
  discoverPlugins: "/marketplace/discover/plugins",
  discoverAiTools: "/marketplace/discover/ai-tools",
  discoverServiceBundles: "/marketplace/discover/service-bundles",
  installedPlugins: "/marketplace/installed/plugins",
  installedAiTools: "/marketplace/installed/ai-tools",
  installedServiceBundles: "/marketplace/installed/service-bundles",
  publishSubmissions: "/marketplace/publish/submissions",
  publishSubmissionReview: "/marketplace/publish/submission-review",
  billing: "/billing",
  licenses: "/billing/licenses",
  sources: "/settings/sources",
} as const;

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
  { from: "/marketplace/publish", to: ROUTES.publishSubmissions },
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
  { from: "/marketplace/bundles", to: ROUTES.discoverServiceBundles },
  { from: "/platform/bundles", to: ROUTES.discoverServiceBundles },
  // The "Plugins" family (before #2197).
  { from: "/plugins", to: ROUTES.discoverPlugins },
  { from: "/plugins/available", to: ROUTES.discoverPlugins },
  { from: "/plugins/installed", to: ROUTES.installedPlugins },
  { from: "/plugins/config", to: ROUTES.installedPlugins },
  { from: "/plugins/ai-tools", to: ROUTES.discoverAiTools },
  { from: "/plugins/submissions", to: ROUTES.publishSubmissions },
  { from: "/plugins/review", to: ROUTES.publishSubmissionReview },
  { from: "/plugins/licenses", to: ROUTES.licenses },
  { from: "/plugins/sources", to: ROUTES.sources },
  { from: "/plugins/sources/:repositoryId", to: `${ROUTES.sources}/:repositoryId` },
  // The "AI Tools" family (before #2197).
  { from: "/ai-tools", to: ROUTES.discoverAiTools },
  { from: "/ai-tools/available", to: ROUTES.discoverAiTools },
  { from: "/ai-tools/installed", to: ROUTES.installedAiTools },
  // The "Bundles" family (before #2197).
  { from: "/bundles", to: ROUTES.discoverServiceBundles },
  { from: "/bundles/available", to: ROUTES.discoverServiceBundles },
  { from: "/bundles/installed", to: ROUTES.installedServiceBundles },
];
