import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Installation } from "../lib/types";
import {
  AvailablePluginsPage,
  PluginCard,
  type Plugin,
} from "./AvailablePluginsPage";

const apiFetch = vi.fn();

vi.mock("../lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  friendlyErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
}));
vi.mock("react-router-dom", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useSearchParams: () => [new URLSearchParams(), () => {}],
}));

// Mutable per test (like GraphExplorerPage.test.tsx's behavior vars) so both
// the logged-out and logged-in/authenticated paths can be exercised.
let mockAuth = { token: "", isAuthenticated: false };
vi.mock("../lib/auth", () => ({
  useAuth: () => mockAuth,
}));
vi.mock("../components/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true), dialog: null }),
}));

function plugin(overrides: Partial<Plugin> = {}): Plugin {
  return {
    id: "p1",
    name: "weather",
    display_name: "Weather",
    description: "Current weather lookups",
    author: "Minder",
    repository_url: null,
    distribution_type: "docker",
    docker_image: null,
    current_version: "1.0.0",
    pricing_model: "free",
    base_tier: "community",
    status: "approved",
    featured: false,
    download_count: 3,
    rating_average: null,
    rating_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    published_at: null,
    developer_id: null,
    category_id: null,
    requires_services: [],
    screenshots: [],
    ...overrides,
  };
}

function installation(overrides: Partial<Installation> = {}): Installation {
  return {
    installation_id: "i1",
    plugin_id: "p1",
    version: "1.0.0",
    status: "active",
    enabled: true,
    installed_at: "2026-01-01T00:00:00Z",
    last_updated_at: "2026-01-01T00:00:00Z",
    name: "weather",
    display_name: "Weather",
    description: null,
    current_version: "1.0.0",
    pricing_model: "free",
    base_tier: "community",
    category_id: null,
    author: "Minder",
    requires_services: [],
    ...overrides,
  };
}

function renderCard(overrides: {
  plugin?: Plugin;
  installation?: Installation;
  isAuthenticated?: boolean;
  isAdmin?: boolean;
  confirm?: ReturnType<typeof vi.fn>;
  onInstalled?: ReturnType<typeof vi.fn>;
  onUninstalled?: ReturnType<typeof vi.fn>;
  onToggleEnabled?: ReturnType<typeof vi.fn>;
} = {}) {
  const confirm = overrides.confirm ?? vi.fn().mockResolvedValue(true);
  const onInstalled = overrides.onInstalled ?? vi.fn();
  const onUninstalled = overrides.onUninstalled ?? vi.fn();
  const onToggleEnabled = overrides.onToggleEnabled ?? vi.fn();
  render(
    <PluginCard
      plugin={overrides.plugin ?? plugin()}
      installation={overrides.installation}
      token="tok"
      isAuthenticated={overrides.isAuthenticated ?? true}
      isAdmin={overrides.isAdmin ?? false}
      onInstalled={onInstalled}
      onUninstalled={onUninstalled}
      onToggleEnabled={onToggleEnabled}
      confirm={confirm}
    />,
  );
  return { confirm, onInstalled, onUninstalled, onToggleEnabled };
}

describe("PluginCard", () => {
  afterEach(() => {
    cleanup();
    apiFetch.mockReset();
  });

  it("installs the plugin and shows the success banner", async () => {
    apiFetch.mockResolvedValue({});
    const { onInstalled } = renderCard({ installation: undefined });

    fireEvent.click(screen.getByRole("button", { name: "Install Weather" }));

    await screen.findByText(/Installed\. If this plugin exposes an AI tool/);
    expect(apiFetch).toHaveBeenCalledWith("/v1/marketplace/plugins/p1/install", {
      method: "POST",
      token: "tok",
    });
    expect(onInstalled).toHaveBeenCalledTimes(1);
  });

  it("shows a friendly error and no success banner when install fails", async () => {
    apiFetch.mockRejectedValue(new Error("Plugin already installed"));
    renderCard({ installation: undefined });

    fireEvent.click(screen.getByRole("button", { name: "Install Weather" }));

    await screen.findByText("Plugin already installed");
    expect(
      screen.queryByText(/Installed\. If this plugin exposes an AI tool/),
    ).toBeNull();
  });

  it("does not uninstall when the confirmation is declined", async () => {
    const { onUninstalled } = renderCard({
      installation: installation(),
      confirm: vi.fn().mockResolvedValue(false),
    });

    fireEvent.click(screen.getByRole("button", { name: "Uninstall Weather" }));

    await vi.waitFor(() => {}); // let the confirm() promise settle
    expect(apiFetch).not.toHaveBeenCalled();
    expect(onUninstalled).not.toHaveBeenCalled();
  });

  it("uninstalls the plugin once confirmed", async () => {
    apiFetch.mockResolvedValue({});
    const { onUninstalled } = renderCard({ installation: installation() });

    fireEvent.click(screen.getByRole("button", { name: "Uninstall Weather" }));

    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/v1/marketplace/plugins/p1/uninstall",
        { method: "DELETE", token: "tok" },
      ),
    );
    expect(onUninstalled).toHaveBeenCalledWith("p1");
  });

  it("disables an enabled plugin via the enable/disable toggle", async () => {
    apiFetch.mockResolvedValue({});
    const { onToggleEnabled } = renderCard({
      installation: installation({ enabled: true }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Disable Weather" }));

    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/v1/marketplace/plugins/p1/disable",
        { method: "POST", token: "tok" },
      ),
    );
    expect(onToggleEnabled).toHaveBeenCalledWith("p1", false);
  });

  it("enables a disabled plugin via the enable/disable toggle", async () => {
    apiFetch.mockResolvedValue({});
    const { onToggleEnabled } = renderCard({
      installation: installation({ enabled: false }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Enable Weather" }));

    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/v1/marketplace/plugins/p1/enable",
        { method: "POST", token: "tok" },
      ),
    );
    expect(onToggleEnabled).toHaveBeenCalledWith("p1", true);
  });

  it("renders a screenshot gallery when the listing carries media (#1521)", () => {
    renderCard({
      plugin: plugin({
        screenshots: [
          "https://cdn.example.com/one.png",
          "https://cdn.example.com/two.png",
        ],
      }),
    });

    const imgs = screen.getAllByRole("img", { name: /Weather screenshot/ });
    expect(imgs).toHaveLength(2);
    expect(imgs[0].getAttribute("src")).toBe("https://cdn.example.com/one.png");
  });

  it("renders no gallery when the listing has no screenshots (#1521)", () => {
    renderCard({ plugin: plugin({ screenshots: [] }) });

    expect(
      screen.queryByRole("img", { name: /Weather screenshot/ }),
    ).toBeNull();
  });

  it("disables the Install button and shows a login hint when logged out", () => {
    renderCard({ installation: undefined, isAuthenticated: false });

    expect(
      screen.getByRole("button", { name: "Install Weather" }).hasAttribute("disabled"),
    ).toBe(true);
    // The reason is visible text, and associated with the button for AT.
    const hint = screen.getByText("Log in to install");
    expect(
      screen.getByRole("button", { name: "Install Weather" }).getAttribute("aria-describedby"),
    ).toBe(hint.id);
  });

  it("hides the 'Install from this repo' affordance for non-admins", () => {
    renderCard({
      plugin: plugin({ repository_url: "https://github.com/acme/weather" }),
      isAdmin: false,
    });

    expect(screen.queryByText("Install from this repo")).toBeNull();
  });

  it("hides the 'Install from this repo' affordance when there is no repository_url", () => {
    renderCard({ plugin: plugin({ repository_url: null }), isAdmin: true });

    expect(screen.queryByText("Install from this repo")).toBeNull();
  });

  it("installs from the repo for an admin, posting repo_url + optional ref/subpath", async () => {
    apiFetch.mockResolvedValue({
      message: "Plugin weather installed successfully",
      plugin: "weather",
      webhook_path: "/webhook/weather",
    });
    renderCard({
      plugin: plugin({ repository_url: "https://github.com/acme/weather" }),
      isAdmin: true,
    });

    fireEvent.click(
      screen.getByText("Install from this repo", { selector: "summary" }),
    );
    fireEvent.change(screen.getByLabelText("Git ref"), {
      target: { value: "v1.2.0" },
    });
    fireEvent.change(screen.getByLabelText("Manifest subpath"), {
      target: { value: "plugins/weather" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Install Weather from this repo" }),
    );

    await screen.findByText(/installed successfully/);
    expect(apiFetch).toHaveBeenCalledWith("/v1/plugins/install-from-git", {
      method: "POST",
      token: "tok",
      body: {
        repo_url: "https://github.com/acme/weather",
        ref: "v1.2.0",
        subpath: "plugins/weather",
      },
    });
  });

  it("sends only repo_url when no ref/subpath/token are provided", async () => {
    apiFetch.mockResolvedValue({
      message: "Plugin weather installed successfully",
      plugin: "weather",
      webhook_path: null,
    });
    renderCard({
      plugin: plugin({ repository_url: "https://github.com/acme/weather" }),
      isAdmin: true,
    });

    fireEvent.click(
      screen.getByText("Install from this repo", { selector: "summary" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Install Weather from this repo" }),
    );

    await screen.findByText(/installed successfully/);
    expect(apiFetch).toHaveBeenCalledWith("/v1/plugins/install-from-git", {
      method: "POST",
      token: "tok",
      body: { repo_url: "https://github.com/acme/weather" },
    });
  });

  it("surfaces the backend error (e.g. SSRF-rejected URL) without crashing", async () => {
    apiFetch.mockRejectedValue(new Error("Repository URL is not allowed"));
    renderCard({
      plugin: plugin({ repository_url: "https://github.com/acme/weather" }),
      isAdmin: true,
    });

    fireEvent.click(
      screen.getByText("Install from this repo", { selector: "summary" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Install Weather from this repo" }),
    );

    await screen.findByText("Repository URL is not allowed");
  });
});

// Routes apiFetch by the real path shapes AvailablePluginsPage's three
// concurrent loaders hit (featured / catalog+search / my installations),
// mirroring AvailableToolsPage.test.tsx's approach for the same page shape.
function routeApiFetch(handlers: {
  featured?: Plugin[];
  catalog?: (offset: number) => { items: Plugin[]; total: number };
  installations?: Installation[];
}) {
  apiFetch.mockImplementation(async (path: string) => {
    if (path.startsWith("/v1/marketplace/plugins/featured")) {
      const items = handlers.featured ?? [];
      return { plugins: items, count: items.length, total: items.length, limit: 6, offset: 0 };
    }
    if (path.startsWith("/v1/marketplace/installations/me")) {
      const installations = handlers.installations ?? [];
      return { installations, count: installations.length };
    }
    if (path.startsWith("/v1/graph/recommendations")) {
      return { recommendations: [] };
    }
    const offset = Number(new URL(path, "http://x").searchParams.get("offset") ?? 0);
    const page = handlers.catalog ? handlers.catalog(offset) : { items: [], total: 0 };
    return { plugins: page.items, count: page.items.length, total: page.total, limit: 20, offset };
  });
}

describe("AvailablePluginsPage", () => {
  afterEach(() => {
    cleanup();
    apiFetch.mockReset();
    mockAuth = { token: "", isAuthenticated: false };
  });

  it("renders the catalog and excludes plugins already shown in Featured", async () => {
    routeApiFetch({
      featured: [plugin({ id: "p1", display_name: "Weather" })],
      catalog: () => ({
        items: [
          plugin({ id: "p1", display_name: "Weather" }),
          plugin({ id: "p2", display_name: "Translate", name: "translate" }),
        ],
        total: 2,
      }),
    });
    render(<AvailablePluginsPage />);

    await screen.findByText("Translate");
    // p1 is Featured, so its catalog-list card should NOT also render below.
    expect(screen.getAllByText("Weather")).toHaveLength(1);
  });

  it("keeps a Featured plugin visible in search results (a query browses the whole catalog)", async () => {
    mockAuth = { token: "", isAuthenticated: false };
    routeApiFetch({
      featured: [plugin({ id: "p1", display_name: "Weather" })],
      catalog: () => ({ items: [plugin({ id: "p1", display_name: "Weather" })], total: 1 }),
    });
    render(<AvailablePluginsPage />);
    // Before searching: Featured section renders it, catalog excludes the
    // duplicate -- so it's only under the "Featured" heading.
    await screen.findByText("Featured", { exact: false });
    expect(screen.getAllByText("Weather")).toHaveLength(1);

    fireEvent.change(screen.getByLabelText("Search plugins"), {
      target: { value: "weather" },
    });

    // Debounced 300ms -- once the post-debounce refetch lands, the Featured
    // section unmounts (query.trim() is now truthy) while the *catalog*
    // render still shows the plugin -- proving the exclusion filter was
    // skipped for this query, not just that Featured disappeared.
    await vi.waitFor(
      () => expect(screen.queryByText("Featured", { exact: false })).toBeNull(),
      { timeout: 1000 },
    );
    expect(screen.getByText("Weather")).toBeTruthy();
  });

  it("shows a Load more button when more results exist, and fetches the next page", async () => {
    routeApiFetch({
      catalog: (offset) =>
        offset === 0
          ? { items: [plugin({ id: "p1", display_name: "Weather" })], total: 2 }
          : { items: [plugin({ id: "p2", display_name: "Translate", name: "translate" })], total: 2 },
    });
    render(<AvailablePluginsPage />);
    await screen.findByText("Weather");

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    await screen.findByText("Translate");
    expect(apiFetch).toHaveBeenLastCalledWith("/v1/marketplace/plugins?limit=20&offset=20");
  });

  it("does not show Load more once every result has loaded", async () => {
    routeApiFetch({ catalog: () => ({ items: [plugin()], total: 1 }) });
    render(<AvailablePluginsPage />);

    await screen.findByText("Weather");
    expect(screen.queryByText("Load more")).toBeNull();
  });

  it("shows an empty state when the catalog has no plugins at all", async () => {
    routeApiFetch({ catalog: () => ({ items: [], total: 0 }) });
    render(<AvailablePluginsPage />);

    await screen.findByText("No plugins in the catalog yet.");
  });

  it("shows a search-specific empty state when a query matches nothing", async () => {
    routeApiFetch({ catalog: () => ({ items: [], total: 0 }) });
    render(<AvailablePluginsPage />);
    await screen.findByText("No plugins in the catalog yet.");

    fireEvent.change(screen.getByLabelText("Search plugins"), {
      target: { value: "nope" },
    });

    await screen.findByText("No plugins match your search.");
  });

  it("flips an installed plugin's enabled state via the real page-level handler", async () => {
    mockAuth = { token: "tok", isAuthenticated: true };
    routeApiFetch({
      catalog: () => ({ items: [plugin({ id: "p1", display_name: "Weather" })], total: 1 }),
      installations: [installation({ plugin_id: "p1", enabled: true })],
    });
    const { container } = render(<AvailablePluginsPage />);
    const statusBadge = () =>
      container.querySelector("[data-status-badge^='Your install:']");
    await screen.findByRole("button", { name: "Disable Weather" });
    expect(statusBadge()?.textContent).toBe("Your install: Enabled");

    fireEvent.click(screen.getByRole("button", { name: "Disable Weather" }));

    await screen.findByRole("button", { name: "Enable Weather" });
    expect(statusBadge()?.textContent).toBe("Your install: Disabled");
  });

  it("shows recommendations and an installed count once logged in with installs", async () => {
    mockAuth = { token: "tok", isAuthenticated: true };
    routeApiFetch({
      catalog: () => ({ items: [], total: 0 }),
      installations: [installation({ plugin_id: "p1" })],
    });
    apiFetch.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === "/v1/graph/recommendations?limit=5" && opts?.method === "POST") {
        return { recommendations: [{ plugin_id: "p9", name: "News", score: 0.9 }] };
      }
      if (path.startsWith("/v1/marketplace/installations/me")) {
        return { installations: [installation({ plugin_id: "p1" })], count: 1 };
      }
      if (path.startsWith("/v1/marketplace/plugins/featured")) {
        return { plugins: [], count: 0, total: 0, limit: 6, offset: 0 };
      }
      return { plugins: [], count: 0, total: 0, limit: 20, offset: 0 };
    });
    render(<AvailablePluginsPage />);

    await screen.findByText(/You have 1 plugin installed/);
    expect(screen.getByText(/Recommended based on what you've installed:/)).toBeTruthy();
    expect(screen.getByText(/News/)).toBeTruthy();
  });

  it("renders (does not crash) when the recommendations response omits `recommendations`", async () => {
    mockAuth = { token: "tok", isAuthenticated: true };
    apiFetch.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === "/v1/graph/recommendations?limit=5" && opts?.method === "POST") {
        return {}; // malformed/omitted-key response
      }
      if (path.startsWith("/v1/marketplace/installations/me")) {
        return { installations: [installation({ plugin_id: "p1" })], count: 1 };
      }
      return { plugins: [], count: 0, total: 0, limit: 20, offset: 0 };
    });

    render(<AvailablePluginsPage />);

    await screen.findByText(/You have 1 plugin installed/);
    expect(screen.queryByText(/Recommended based on/)).toBeNull();
  });

  it("re-fetches with a pricing_model query param when the pricing filter changes (#1519)", async () => {
    routeApiFetch({ catalog: () => ({ items: [plugin()], total: 1 }) });
    render(<AvailablePluginsPage />);
    await screen.findByText("Weather");

    fireEvent.change(screen.getByLabelText("Filter by pricing"), {
      target: { value: "paid" },
    });

    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenLastCalledWith(
        "/v1/marketplace/plugins?limit=20&offset=0&pricing_model=paid",
      ),
    );
  });

  it("does not add a pricing_model param when no filter is set (unchanged default request)", async () => {
    routeApiFetch({ catalog: () => ({ items: [plugin()], total: 1 }) });
    render(<AvailablePluginsPage />);
    await screen.findByText("Weather");

    expect(apiFetch).toHaveBeenCalledWith("/v1/marketplace/plugins?limit=20&offset=0");
  });

  it("never shows a raw category UUID -- not on a card, not as a filter option (#2195)", async () => {
    // The catalog only carries an opaque category_id and no endpoint resolves
    // it to a name, so neither a badge nor a filter option may render it.
    const uuid = "6f1c2b9e-3d4a-4c5b-8e7f-0a1b2c3d4e5f";
    routeApiFetch({
      catalog: () => ({ items: [plugin({ category_id: uuid })], total: 1 }),
      featured: [plugin({ id: "f1", display_name: "Featured One", category_id: uuid })],
    });
    const { container } = render(<AvailablePluginsPage />);
    await screen.findByText("Weather");

    expect(container.textContent).not.toContain(uuid);
    expect(container.innerHTML).not.toContain(uuid);
    expect(screen.queryByLabelText("Filter by category")).toBeNull();
  });

  it("filters search results client-side by pricing_model (the search endpoint has no such param)", async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith("/v1/marketplace/plugins/search")) {
        return {
          plugins: [
            plugin({ id: "p1", display_name: "Weather", pricing_model: "free" }),
            plugin({ id: "p2", display_name: "Translate", name: "translate", pricing_model: "paid" }),
          ],
          count: 2,
          total: 2,
          limit: 20,
          offset: 0,
        };
      }
      return { plugins: [], count: 0, total: 0, limit: 20, offset: 0 };
    });
    render(<AvailablePluginsPage />);

    fireEvent.change(screen.getByLabelText("Search plugins"), {
      target: { value: "weather" },
    });
    fireEvent.change(screen.getByLabelText("Filter by pricing"), {
      target: { value: "paid" },
    });

    await vi.waitFor(() => expect(screen.getByText("Translate")).toBeTruthy());
    expect(screen.queryByText("Weather")).toBeNull();
  });
});
