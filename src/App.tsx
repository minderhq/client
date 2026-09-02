import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { BrandMark } from "./components/BrandMark";
import { CommandPalette } from "./components/CommandPalette";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Icon } from "./components/Icon";
import { OrgSwitcher } from "./components/OrgSwitcher";
import { PageTabs } from "./components/PageTabs";
import { Sidebar } from "./components/Sidebar";
import { ThemeToggle } from "./components/ThemeToggle";
import { UserMenu } from "./components/UserMenu";
import { AuthProvider } from "./lib/auth";
import { iconButtonClass, kbdClass, pageEnterClass } from "./lib/ui";
import { AskPage } from "./pages/AskPage";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { AvailableBundlesPage } from "./pages/AvailableBundlesPage";
import { AvailablePluginsPage } from "./pages/AvailablePluginsPage";
import { AllOrganizationsPage } from "./pages/AllOrganizationsPage";
import { AuditLogPage } from "./pages/AuditLogPage";
import { AvailableToolsPage } from "./pages/AvailableToolsPage";
import { BackupsPage } from "./pages/BackupsPage";
import { ConversationsPage } from "./pages/ConversationsPage";
import { GraphExplorerPage } from "./pages/GraphExplorerPage";
import { HomePage } from "./pages/HomePage";
import { InstalledBundlesPage } from "./pages/InstalledBundlesPage";
import { InstalledPluginsPage } from "./pages/InstalledPluginsPage";
import { InstalledToolsPage } from "./pages/InstalledToolsPage";
import { InviteRedeemPage } from "./pages/InviteRedeemPage";
import { KnowledgeBasesPage } from "./pages/KnowledgeBasesPage";
import { LoginPage } from "./pages/LoginPage";
import { ModelManagementPage } from "./pages/ModelManagementPage";
import { MyLicensesPage } from "./pages/MyLicensesPage";
import { OrganizationPage } from "./pages/OrganizationPage";
import { RagPipelinesPage } from "./pages/RagPipelinesPage";
import { ReviewQueuePage } from "./pages/ReviewQueuePage";
import { SettingsPage } from "./pages/SettingsPage";
import { SubmissionsPage } from "./pages/SubmissionsPage";
import { StatusPage } from "./pages/StatusPage";
import { EntityMergeReviewPage } from "./pages/EntityMergeReviewPage";
import { TaxonomyReviewPage } from "./pages/TaxonomyReviewPage";
import { TeamsPage } from "./pages/TeamsPage";
import { UsersPage } from "./pages/UsersPage";
import { VoicePage } from "./pages/VoicePage";

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export function App() {
  // Mobile-only: the sidebar is always visible on lg+ (Sidebar.tsx's own
  // lg:translate-x-0 lg:static), this only controls the slide-in overlay
  // below that breakpoint.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Re-key the ErrorBoundary per route so navigating to another page clears a
  // previous page's crash instead of staying stuck on the fallback.
  const location = useLocation();

  // Global ⌘K / Ctrl-K toggles the command palette from anywhere.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
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
              aria-label="Toggle navigation"
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
              aria-label="Open command palette"
              className="ml-1 hidden w-full max-w-sm items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-400 shadow-sm transition hover:border-gray-400 hover:text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600 sm:flex"
            >
              <Icon name="search" size={16} />
              <span>Search or jump to…</span>
              <span className="ml-auto flex items-center gap-0.5">
                <kbd className={kbdClass}>{isMac ? "⌘" : "Ctrl"}</kbd>
                <kbd className={kbdClass}>K</kbd>
              </span>
            </button>

            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                aria-label="Open command palette"
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

          <main className="mx-auto w-full max-w-5xl flex-1 p-6">
            <ErrorBoundary key={location.pathname}>
              <div className={pageEnterClass}>
                <PageTabs />
                <Routes>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/ask" element={<AskPage />} />
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/auth/callback" element={<AuthCallbackPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/invite/:token" element={<InviteRedeemPage />} />

                  <Route path="/rag" element={<KnowledgeBasesPage />} />
                  <Route path="/rag/pipelines" element={<RagPipelinesPage />} />
                  <Route path="/rag/graph" element={<GraphExplorerPage />} />
                  <Route
                    path="/rag/taxonomy-review"
                    element={<TaxonomyReviewPage />}
                  />
                  <Route
                    path="/rag/entity-merges"
                    element={<EntityMergeReviewPage />}
                  />
                  <Route path="/rag/conversations" element={<ConversationsPage />} />

                  <Route
                    path="/plugins"
                    element={<Navigate to="/plugins/available" replace />}
                  />
                  <Route
                    path="/plugins/available"
                    element={<AvailablePluginsPage />}
                  />
                  <Route
                    path="/plugins/installed"
                    element={<InstalledPluginsPage />}
                  />
                  <Route
                    path="/plugins/submissions"
                    element={<SubmissionsPage />}
                  />
                  <Route path="/plugins/review" element={<ReviewQueuePage />} />
                  <Route path="/plugins/licenses" element={<MyLicensesPage />} />

                  <Route
                    path="/ai-tools"
                    element={<Navigate to="/ai-tools/available" replace />}
                  />
                  <Route
                    path="/ai-tools/available"
                    element={<AvailableToolsPage />}
                  />
                  <Route
                    path="/ai-tools/installed"
                    element={<InstalledToolsPage />}
                  />

                  <Route
                    path="/bundles"
                    element={<Navigate to="/bundles/available" replace />}
                  />
                  <Route
                    path="/bundles/available"
                    element={<AvailableBundlesPage />}
                  />
                  <Route
                    path="/bundles/installed"
                    element={<InstalledBundlesPage />}
                  />

                  <Route path="/platform" element={<ModelManagementPage />} />
                  <Route path="/platform/status" element={<StatusPage />} />
                  <Route path="/platform/voice" element={<VoicePage />} />
                  <Route path="/platform/backups" element={<BackupsPage />} />
                  <Route path="/platform/users" element={<UsersPage />} />
                  <Route path="/platform/teams" element={<TeamsPage />} />
                  <Route path="/organization" element={<OrganizationPage />} />
                  <Route path="/organizations" element={<AllOrganizationsPage />} />
                  <Route path="/audit" element={<AuditLogPage />} />

                  {/* Old flat/pre-restructure routes, kept as redirects so existing
                    bookmarks/links still land somewhere sensible instead of the
                    catch-all. */}
                  <Route
                    path="/knowledge-bases"
                    element={<Navigate to="/rag" replace />}
                  />
                  <Route
                    path="/rag-pipelines"
                    element={<Navigate to="/rag/pipelines" replace />}
                  />
                  <Route
                    path="/plugin-config"
                    element={<Navigate to="/plugins/installed" replace />}
                  />
                  <Route
                    path="/marketplace"
                    element={<Navigate to="/plugins/available" replace />}
                  />
                  <Route
                    path="/marketplace/plugins"
                    element={<Navigate to="/plugins/available" replace />}
                  />
                  <Route
                    path="/marketplace/plugins/available"
                    element={<Navigate to="/plugins/available" replace />}
                  />
                  <Route
                    path="/marketplace/plugins/installed"
                    element={<Navigate to="/plugins/installed" replace />}
                  />
                  <Route
                    path="/marketplace/plugins/ai-tools"
                    element={<Navigate to="/ai-tools/available" replace />}
                  />
                  <Route
                    path="/marketplace/bundles"
                    element={<Navigate to="/bundles/available" replace />}
                  />
                  <Route
                    path="/platform/bundles"
                    element={<Navigate to="/bundles/available" replace />}
                  />
                  <Route
                    path="/plugins/ai-tools"
                    element={<Navigate to="/ai-tools/available" replace />}
                  />
                  <Route
                    path="/plugins/config"
                    element={<Navigate to="/plugins/installed" replace />}
                  />

                  {/* Unmatched paths (including the removed /model-management, still
                    served 200 by nginx's SPA fallback since it can't tell client-side
                    routes apart) redirect home instead of rendering a blank page. */}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </div>
            </ErrorBoundary>
          </main>
        </div>

        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      </div>
    </AuthProvider>
  );
}
