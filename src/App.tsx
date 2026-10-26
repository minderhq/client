import { useEffect, useRef, useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";

import { BrandMark } from "./components/BrandMark";
import { Breadcrumbs } from "./components/Breadcrumbs";
import { CommandPalette } from "./components/CommandPalette";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Icon } from "./components/Icon";
import { OrgSwitcher } from "./components/OrgSwitcher";
import { PageTabs } from "./components/PageTabs";
import { RedirectWithQuery } from "./components/RedirectWithQuery";
import { RequirePermission } from "./components/RequirePermission";
import { Sidebar } from "./components/Sidebar";
import { ThemeToggle } from "./components/ThemeToggle";
import { UserMenu } from "./components/UserMenu";
import { useI18n } from "./i18n";
import { REQUEST_INBOX_REQUIRES } from "./lib/accessRequests";
import { AuthProvider } from "./lib/auth";
import { isModalOpen } from "./lib/modalLayer";
import { MEMBER, PLATFORM_ADMIN } from "./lib/permissions";
import { LEGACY_REDIRECTS, ROUTES, SECTION_REDIRECTS } from "./lib/routes";
import { iconButtonClass, kbdClass, pageEnterClass } from "./lib/ui";
import { useRouteFocus } from "./lib/useRouteFocus";
import { AskPage } from "./pages/AskPage";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { AvailableBundlesPage } from "./pages/AvailableBundlesPage";
import { AvailablePluginsPage } from "./pages/AvailablePluginsPage";
import { AllOrganizationsPage } from "./pages/AllOrganizationsPage";
import { AuditLogPage } from "./pages/AuditLogPage";
import { AvailableToolsPage } from "./pages/AvailableToolsPage";
import { BackupsPage } from "./pages/BackupsPage";
import { BillingPage } from "./pages/BillingPage";
import { CloudProvidersPage } from "./pages/CloudProvidersPage";
import { ConversationsPage } from "./pages/ConversationsPage";
import { ForcePasswordChangeGate } from "./pages/ForcePasswordChangePage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { GraphExplorerPage } from "./pages/GraphExplorerPage";
import { HomePage } from "./pages/HomePage";
import { InstalledBundlesPage } from "./pages/InstalledBundlesPage";
import { InstalledPluginsPage } from "./pages/InstalledPluginsPage";
import { InstalledToolsPage } from "./pages/InstalledToolsPage";
import { InviteRedeemPage } from "./pages/InviteRedeemPage";
import { KnowledgeBasesPage } from "./pages/KnowledgeBasesPage";
import { MyTeamPage } from "./pages/MyTeamPage";
import { ModelDefaultsPage } from "./pages/ModelDefaultsPage";
import { LoginPage } from "./pages/LoginPage";
import { ModelManagementPage } from "./pages/ModelManagementPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { OrganizationPage } from "./pages/OrganizationPage";
import { OrgPluginsPage } from "./pages/OrgPluginsPage";
import { OrgUsersPage } from "./pages/OrgUsersPage";
import { PeopleDomainsPage } from "./pages/PeopleDomainsPage";
import { PeopleInvitesPage } from "./pages/PeopleInvitesPage";
import { PersonPage } from "./pages/PersonPage";
import { PluginSourceRepositoriesPage } from "./pages/PluginSourceRepositoriesPage";
import { PublicChatConversationsPage } from "./pages/PublicChatConversationsPage";
import { PublicChatEndpointsPage } from "./pages/PublicChatEndpointsPage";
import { RagPipelinesPage } from "./pages/RagPipelinesPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { RequestsPage, RequestsRedirect } from "./pages/RequestsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { StatusPage } from "./pages/StatusPage";
import { EntityMergeReviewPage } from "./pages/EntityMergeReviewPage";
import { TaxonomyReviewPage } from "./pages/TaxonomyReviewPage";
import { TeamsPage } from "./pages/TeamsPage";
import { UsersPage } from "./pages/UsersPage";
import { VerifyEmailPage } from "./pages/VerifyEmailPage";
import { VoicePage } from "./pages/VoicePage";
import { WorkspaceGate } from "./pages/WaitingRoomPage";

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
/** The palette shortcut's modifier key, as printed on the keyboard. */
const MOD_KEY = isMac ? "⌘" : "Ctrl";

export function App() {
  // Mobile-only: the sidebar is always visible on lg+ (Sidebar.tsx's own
  // lg:translate-x-0 lg:static), this only controls the slide-in overlay
  // below that breakpoint.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { t } = useI18n();
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Re-key the ErrorBoundary per route so navigating to another page clears a
  // previous page's crash instead of staying stuck on the fallback.
  const location = useLocation();
  // Focus the new page's heading after a client-side navigation (a11y).
  const mainRef = useRef<HTMLElement>(null);
  useRouteFocus(mainRef);

  // Global ⌘K / Ctrl-K toggles the command palette from anywhere -- except
  // while another modal (a confirm dialog, the reset-password dialog) is open:
  // the app behind it is inert, and the dialog owns the keyboard until it
  // closes. The key is still swallowed, so it never falls through to the
  // browser's own ⌘K/Ctrl-K from inside a dialog. A functional update, so two
  // presses before a re-render still toggle twice.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        // Open: close it. Closed: open it, unless another modal is up.
        setPaletteOpen((wasOpen) => !wasOpen && !isModalOpen());
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <AuthProvider>
      <div className="flex min-h-screen text-gray-900 dark:text-gray-100">
        <Sidebar open={sidebarOpen} onNavigate={() => setSidebarOpen(false)} />
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-gray-950/40 backdrop-blur-sm lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}
        <div className="flex min-h-screen flex-1 flex-col">
          <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-gray-200 bg-white/70 px-4 py-2.5 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-950/70">
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              className={`${iconButtonClass} lg:hidden`}
              aria-label={t("shell.toggleNav")}
            >
              <Icon name="menu" size={20} />
            </button>

            <span className="flex items-center gap-2 text-gray-900 dark:text-gray-100 lg:hidden">
              <BrandMark size={20} className="text-indigo-600 dark:text-indigo-400" />
              <span className="font-mono text-base font-bold">Minder</span>
            </span>

            {/* Desktop: a fake search field that opens the palette. Mobile: a
              plain icon button — the field would crowd the narrow bar. */}
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label={t("shell.openPalette")}
              className="ml-1 hidden w-full max-w-sm items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-400 shadow-sm transition hover:border-gray-400 hover:text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600 sm:flex"
            >
              <Icon name="search" size={16} />
              <span>{t("shell.searchOrJump")}</span>
              <span className="ml-auto flex items-center gap-0.5">
                <kbd className={kbdClass}>{MOD_KEY}</kbd>
                <kbd className={kbdClass}>K</kbd>
              </span>
            </button>

            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                aria-label={t("shell.openPalette")}
                className={`${iconButtonClass} sm:hidden`}
              >
                <Icon name="search" size={18} />
              </button>
              <div className="hidden sm:block">
                <OrgSwitcher />
              </div>
              <ThemeToggle />
              <div className="mx-1 hidden h-6 w-px bg-gray-200 dark:bg-gray-800 sm:block" />
              <UserMenu />
            </div>
          </header>

          <main ref={mainRef} className="mx-auto w-full max-w-5xl flex-1 p-6">
            <WorkspaceGate>
            <ErrorBoundary key={location.pathname}>
              <div className={pageEnterClass}>
                <ForcePasswordChangeGate>
                  <Breadcrumbs />
                  <PageTabs />
                  <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/ask" element={<AskPage />} />
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/auth/callback" element={<AuthCallbackPage />} />
                    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                    <Route path="/reset-password" element={<ResetPasswordPage />} />
                    <Route path="/verify-email" element={<VerifyEmailPage />} />
                    {/* Me › My account: profile, voice, the caller's own requests. */}
                    <Route path={ROUTES.account} element={<SettingsPage />} />
                    <Route path={ROUTES.voice} element={<VoicePage />} />
                    <Route
                      path={ROUTES.myRequests}
                      element={
                        <RequirePermission requires={MEMBER}>
                          <RequestsPage view="mine" />
                        </RequirePermission>
                      }
                    />
                    {/* The old /requests: the inbox for whoever can open it, the
                      caller's own list for everyone else. */}
                    <Route path="/requests" element={<RequestsRedirect />} />
                    <Route path="/invite/:token" element={<InviteRedeemPage />} />

                    <Route path="/rag" element={<KnowledgeBasesPage />} />
                    <Route path="/rag/pipelines" element={<RagPipelinesPage />} />
                    <Route path="/rag/graph" element={<GraphExplorerPage />} />
                    <Route
                      path="/rag/taxonomy-review"
                      element={<TaxonomyReviewPage />}
                    />
                    <Route path="/rag/conversations" element={<ConversationsPage />} />
                    {/* Route guards (#131): a caller who doesn't meet the requirement
                      gets the forbidden page at the same URL. Each guard asks
                      what the page itself already checks; operator screens
                      check the Platform Admin, never a permission key.
                      Organization › Website chatbots: */}
                    <Route
                      path={ROUTES.chatbots}
                      element={
                        <RequirePermission requires="org.chatbots.manage">
                          <PublicChatEndpointsPage />
                        </RequirePermission>
                      }
                    />
                    <Route
                      path={`${ROUTES.chatbots}/:endpointId/conversations`}
                      element={
                        <RequirePermission requires="org.chatbots.manage">
                          <PublicChatConversationsPage />
                        </RequirePermission>
                      }
                    />
                    <Route
                      path={`${ROUTES.chatbots}/:endpointId/conversations/:sessionId`}
                      element={
                        <RequirePermission requires="org.chatbots.manage">
                          <PublicChatConversationsPage />
                        </RequirePermission>
                      }
                    />

                    {/* Build › Discover: the plugin catalog and what is installed.
                      The AI tools pages have no menu row (a tool is a facet of
                      a plugin); the plugin pages link to them. */}
                    <Route path={ROUTES.discoverPlugins} element={<AvailablePluginsPage />} />
                    <Route path={ROUTES.discoverAiTools} element={<AvailableToolsPage />} />
                    <Route path={ROUTES.installedPlugins} element={<InstalledPluginsPage />} />
                    <Route path={ROUTES.installedAiTools} element={<InstalledToolsPage />} />

                    {/* Platform. Status (public), Local models and Modules stay
                      readable by every member; their admin actions are gated
                      on the pages and by the API. */}
                    <Route path={ROUTES.status} element={<StatusPage />} />
                    <Route path={ROUTES.models} element={<ModelManagementPage />} />
                    <Route path={ROUTES.modules} element={<AvailableBundlesPage />} />
                    <Route path={ROUTES.installedModules} element={<InstalledBundlesPage />} />
                    <Route
                      path={ROUTES.sources}
                      element={
                        <RequirePermission requires={PLATFORM_ADMIN}>
                          <PluginSourceRepositoriesPage />
                        </RequirePermission>
                      }
                    />
                    <Route
                      path={`${ROUTES.sources}/:repositoryId`}
                      element={
                        <RequirePermission requires={PLATFORM_ADMIN}>
                          <PluginSourceRepositoriesPage />
                        </RequirePermission>
                      }
                    />
                    <Route
                      path={ROUTES.backups}
                      element={
                        <RequirePermission requires={PLATFORM_ADMIN}>
                          <BackupsPage />
                        </RequirePermission>
                      }
                    />
                    <Route
                      path={ROUTES.allUsers}
                      element={
                        <RequirePermission requires={PLATFORM_ADMIN}>
                          <UsersPage />
                        </RequirePermission>
                      }
                    />
                    {/* My team (every member); /platform/teams redirects here. */}
                    <Route
                      path={ROUTES.myTeam}
                      element={
                        <RequirePermission requires={MEMBER}>
                          <MyTeamPage />
                        </RequirePermission>
                      }
                    />
                    <Route
                      path={ROUTES.orgTeams}
                      element={
                        <RequirePermission requires="org.teams.manage">
                          <TeamsPage />
                        </RequirePermission>
                      }
                    />
                    <Route path="/organization" element={<OrganizationPage />} />
                    {/* Organization › People (UX step 7); /organization/users redirects here. */}
                    <Route
                      path={ROUTES.people}
                      element={
                        <RequirePermission requires="org.members.manage">
                          <OrgUsersPage />
                        </RequirePermission>
                      }
                    />
                    <Route
                      path={ROUTES.peopleInvites}
                      element={
                        <RequirePermission requires="org.members.manage">
                          <PeopleInvitesPage />
                        </RequirePermission>
                      }
                    />
                    <Route
                      path={ROUTES.requests}
                      element={
                        <RequirePermission requires={REQUEST_INBOX_REQUIRES}>
                          <RequestsPage view="inbox" />
                        </RequirePermission>
                      }
                    />
                    <Route
                      path={ROUTES.peopleDomains}
                      element={
                        <RequirePermission requires="org.settings.manage">
                          <PeopleDomainsPage />
                        </RequirePermission>
                      }
                    />
                    <Route
                      path={`${ROUTES.people}/:userId`}
                      element={
                        <RequirePermission requires="org.members.manage">
                          <PersonPage />
                        </RequirePermission>
                      }
                    />
                    {/* Organization › AI and › Plugins (UX step 9); /platform/providers redirects. */}
                    <Route
                      path={ROUTES.orgAi}
                      element={
                        <RequirePermission requires="org.ai.providers.view">
                          <CloudProvidersPage />
                        </RequirePermission>
                      }
                    />
                    <Route
                      path={ROUTES.orgAiDefaults}
                      element={
                        <RequirePermission requires={MEMBER}>
                          <ModelDefaultsPage />
                        </RequirePermission>
                      }
                    />
                    <Route
                      path={ROUTES.orgPlugins}
                      element={
                        <RequirePermission requires="org.settings.manage">
                          <OrgPluginsPage />
                        </RequirePermission>
                      }
                    />
                    {/* Organization › Knowledge quality: the entity-merge review.
                      Its API serves any member for the candidates they own. */}
                    <Route path={ROUTES.knowledgeQuality} element={<EntityMergeReviewPage />} />
                    <Route path={ROUTES.billing} element={<BillingPage />} />
                    <Route
                      path={ROUTES.allOrganizations}
                      element={
                        <RequirePermission requires={PLATFORM_ADMIN}>
                          <AllOrganizationsPage />
                        </RequirePermission>
                      }
                    />
                    {/* Organization › Security › Audit log (the active org) and
                      Platform › Platform audit log (the whole installation). */}
                    <Route
                      path={ROUTES.orgAudit}
                      element={
                        <RequirePermission requires="org.audit.view">
                          <AuditLogPage scope="org" />
                        </RequirePermission>
                      }
                    />
                    <Route
                      path={ROUTES.platformAudit}
                      element={
                        <RequirePermission requires={PLATFORM_ADMIN}>
                          <AuditLogPage scope="platform" />
                        </RequirePermission>
                      }
                    />

                    {/* Section indexes and every pre-restructure URL redirect to
                      the current page, keeping the query string (?source=, ?q=)
                      so old bookmarks and docs links land on the same view. */}
                    {[...SECTION_REDIRECTS, ...LEGACY_REDIRECTS].map(({ from, to }) => (
                      <Route key={from} path={from} element={<RedirectWithQuery to={to} />} />
                    ))}

                    {/* Unmatched paths (including the removed /model-management, still
                      served 200 by nginx's SPA fallback since it can't tell client-side
                      routes apart) get a real 404 page instead of a blank one. */}
                    <Route path="*" element={<NotFoundPage onSearch={() => setPaletteOpen(true)} />} />
                  </Routes>
                </ForcePasswordChangeGate>
              </div>
            </ErrorBoundary>
            </WorkspaceGate>
          </main>
        </div>

        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      </div>
    </AuthProvider>
  );
}
