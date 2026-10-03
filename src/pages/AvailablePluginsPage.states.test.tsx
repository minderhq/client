// Loading / empty / error states, recoverable secondary failures, accessible
// names and recommendation links on Discover plugins (#2195), against a real
// router so ?q= deep links are exercised end to end.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CatalogPlugin } from "../lib/marketplace";
import type { Installation } from "../lib/types";
import { AvailablePluginsPage } from "./AvailablePluginsPage";

const apiFetch = vi.fn();
vi.mock("../lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  friendlyErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
}));
let mockAuth = { token: "", isAuthenticated: false, role: null as string | null, sessionKey: 0 };
vi.mock("../lib/auth", () => ({ useAuth: () => mockAuth }));
vi.mock("../components/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true), dialog: null }),
}));

function plugin(overrides: Partial<CatalogPlugin>): CatalogPlugin {
  return {
    id: "p",
    name: "p",
    display_name: "P",
    description: null,
    author: "Someone",
    repository_url: null,
    distribution_type: "git",
    docker_image: null,
    current_version: "1.0.0",
    pricing_model: "free",
    base_tier: "community",
    status: "approved",
    featured: false,
    download_count: 0,
    rating_average: null,
    rating_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    published_at: null,
    developer_id: null,
    category_id: null,
    requires_services: [],
    screenshots: [],
    origin: "first_party",
    ...overrides,
  };
}

function installation(pluginId: string, enabled = true): Installation {
  return {
    installation_id: `i-${pluginId}`,
    plugin_id: pluginId,
    version: "1.0.0",
    status: "active",
    enabled,
    installed_at: "2026-01-01T00:00:00Z",
    last_updated_at: "2026-01-01T00:00:00Z",
    name: pluginId,
    display_name: pluginId,
    description: null,
    current_version: "1.0.0",
    pricing_model: "free",
    base_tier: "community",
    category_id: null,
    author: null,
    requires_services: [],
  };
}

const WEATHER = plugin({ id: "w", name: "weather", display_name: "Weather" });
const NEWS = plugin({ id: "n", name: "news", display_name: "News" });

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Handler = (path: string, opts?: { method?: string }) => unknown;

/** Routes apiFetch by path. Each handler may return a value, a promise, or
 * throw; unknown paths resolve to an empty catalog page. */
function routeApi(handlers: {
  featured?: Handler;
  catalog?: Handler;
  search?: Handler;
  installations?: Handler;
  recommendations?: Handler;
}) {
  apiFetch.mockImplementation(async (path: string, opts?: { method?: string }) => {
    if (path.startsWith("/v1/marketplace/plugins/featured"))
      return handlers.featured ? handlers.featured(path, opts) : { plugins: [], total: 0 };
    if (path.startsWith("/v1/marketplace/plugins/search"))
      return handlers.search ? handlers.search(path, opts) : { plugins: [], total: 0 };
    if (path.startsWith("/v1/marketplace/plugins"))
      return handlers.catalog ? handlers.catalog(path, opts) : { plugins: [], total: 0 };
    if (path.startsWith("/v1/marketplace/installations/me"))
      return handlers.installations
        ? handlers.installations(path, opts)
        : { installations: [], count: 0 };
    if (path.startsWith("/v1/graph/recommendations"))
      return handlers.recommendations
        ? handlers.recommendations(path, opts)
        : { recommendations: [] };
    return {};
  });
}

let location = "";
function LocationProbe() {
  location = useLocation().search;
  return null;
}

function renderAt(url = "/discover") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/discover"
          element={
            <>
              <AvailablePluginsPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const EMPTY_COPY = "No plugins in the catalog yet.";

afterEach(() => {
  cleanup();
  apiFetch.mockReset();
  location = "";
  mockAuth = { token: "", isAuthenticated: false, role: null, sessionKey: 0 };
});

describe("Discover plugins: catalog states", () => {
  it("shows a skeleton, not the empty state, while the first page is loading", async () => {
    const page = deferred<unknown>();
    routeApi({ catalog: () => page.promise });
    renderAt();

    expect(screen.getByTestId("card-list-skeleton")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Loading plugins…");
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();

    await act(async () => page.resolve({ plugins: [WEATHER], total: 1 }));
    expect(screen.queryByTestId("card-list-skeleton")).toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: "Weather" })).toBeTruthy();
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
  });

  it("shows the empty state only after a successful empty load", async () => {
    routeApi({ catalog: () => ({ plugins: [], total: 0 }) });
    renderAt();

    expect(await screen.findByText(EMPTY_COPY)).toBeTruthy();
    expect(screen.queryByTestId("card-list-skeleton")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a distinct error with Retry on failure -- never the empty state -- and recovers", async () => {
    let fail = true;
    routeApi({
      catalog: () => {
        if (fail) throw new Error("Marketplace is unavailable");
        return { plugins: [WEATHER], total: 1 };
      },
    });
    renderAt();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't load the plugin catalog.");
    expect(alert.textContent).toContain("Marketplace is unavailable");
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
    expect(screen.queryByTestId("card-list-skeleton")).toBeNull();

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry loading the plugin catalog" }));

    expect(await screen.findByRole("heading", { level: 3, name: "Weather" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("replaces stale results with the error when a new search fails", async () => {
    routeApi({
      catalog: () => ({ plugins: [WEATHER], total: 1 }),
      search: () => {
        throw new Error("Search is down");
      },
    });
    renderAt();
    await screen.findByRole("heading", { level: 3, name: "Weather" });

    fireEvent.change(screen.getByLabelText("Search plugins"), { target: { value: "news" } });

    const alert = await screen.findByRole("alert", undefined, { timeout: 1500 });
    expect(alert.textContent).toContain("Couldn't search the plugin catalog.");
    // Weather answered the previous query, not this one.
    expect(screen.queryByRole("heading", { level: 3, name: "Weather" })).toBeNull();
    expect(screen.getByRole("button", { name: "Retry loading search results" })).toBeTruthy();
  });

  it("keeps loaded plugins when Load more fails, and Retry appends the missing page", async () => {
    let failMore = true;
    routeApi({
      catalog: (path) => {
        const offset = Number(new URL(path, "http://x").searchParams.get("offset"));
        if (offset === 0) return { plugins: [WEATHER], total: 2 };
        if (failMore) throw new Error("Timed out");
        return { plugins: [NEWS], total: 2 };
      },
    });
    renderAt();
    await screen.findByRole("heading", { level: 3, name: "Weather" });

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't load more plugins.");
    expect(screen.getByRole("heading", { level: 3, name: "Weather" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();

    failMore = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry loading more plugins" }));
    expect(await screen.findByRole("heading", { level: 3, name: "News" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "Weather" })).toBeTruthy();
  });
});

describe("Discover plugins: secondary failures stay quiet and recoverable", () => {
  it("a featured failure shows a quiet notice with Retry and leaves the catalog usable", async () => {
    let failFeatured = true;
    routeApi({
      featured: () => {
        if (failFeatured) throw new Error("Featured service down");
        return { plugins: [NEWS], total: 1 };
      },
      catalog: () => ({ plugins: [WEATHER, NEWS], total: 2 }),
    });
    renderAt();

    await screen.findByRole("heading", { level: 3, name: "Weather" });
    const notice = await screen.findByText(/Featured plugins couldn't be loaded/);
    expect(notice.closest("[role='status']")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull(); // not a blocking error
    expect(notice.closest("[role='status']")!.textContent).toContain("Featured service down");

    failFeatured = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry loading featured plugins" }));

    expect(await screen.findByRole("heading", { level: 2, name: "Featured" })).toBeTruthy();
    expect(screen.queryByText(/Featured plugins couldn't be loaded/)).toBeNull();
  });

  it("a recommendations failure shows a quiet notice with Retry", async () => {
    mockAuth = { token: "tok", isAuthenticated: true, role: "user", sessionKey: 1 };
    let failRecs = true;
    routeApi({
      catalog: () => ({ plugins: [WEATHER], total: 1 }),
      installations: () => ({ installations: [installation("w")], count: 1 }),
      recommendations: () => {
        if (failRecs) throw new Error("Graph unavailable");
        return { recommendations: [{ plugin_id: "n", name: "News", score: 1 }] };
      },
    });
    renderAt();

    const notice = await screen.findByText(/Recommendations couldn't be loaded/);
    expect(notice.closest("[role='status']")!.textContent).toContain("Graph unavailable");
    expect(screen.getByRole("heading", { level: 3, name: "Weather" })).toBeTruthy();

    failRecs = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry loading recommendations" }));

    expect(await screen.findByRole("link", { name: "News" })).toBeTruthy();
    expect(screen.queryByText(/Recommendations couldn't be loaded/)).toBeNull();
  });

  it("an installations failure says install state may be stale, with Retry", async () => {
    mockAuth = { token: "tok", isAuthenticated: true, role: "user", sessionKey: 1 };
    let failInstalls = true;
    routeApi({
      catalog: () => ({ plugins: [WEATHER], total: 1 }),
      installations: () => {
        if (failInstalls) throw new Error("Unauthorized");
        return { installations: [installation("w")], count: 1 };
      },
    });
    renderAt();

    expect(await screen.findByText(/install state on these cards may be out of date/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Install Weather" })).toBeTruthy();

    failInstalls = false;
    fireEvent.click(
      screen.getByRole("button", { name: "Retry loading your installed plugins" }),
    );
    expect(await screen.findByRole("button", { name: "Disable Weather" })).toBeTruthy();
    expect(screen.queryByText(/may be out of date/)).toBeNull();
  });
});

describe("Discover plugins: accessible names, badges and headings", () => {
  it("names every card action after its plugin", async () => {
    mockAuth = { token: "tok", isAuthenticated: true, role: "admin", sessionKey: 1 };
    routeApi({
      catalog: () => ({
        plugins: [WEATHER, { ...NEWS, repository_url: "https://example.com/news" }],
        total: 2,
      }),
      installations: () => ({ installations: [installation("n", false)], count: 1 }),
    });
    renderAt();
    await screen.findByRole("button", { name: "Enable News" });

    const weather = screen.getByRole("heading", { name: "Weather" }).closest("section")!;
    expect(within(weather).getByRole("button", { name: "Install Weather" })).toBeTruthy();
    const depsSummary = within(weather).getByText("Dependencies & conflicts", { selector: "summary" });
    expect(depsSummary.getAttribute("aria-label")).toBe("Dependencies & conflicts for Weather");

    const news = screen.getByRole("heading", { name: "News" }).closest("section")!;
    expect(within(news).getByRole("button", { name: "Enable News" })).toBeTruthy();
    expect(within(news).getByRole("button", { name: "Uninstall News" })).toBeTruthy();
    const repoSummary = within(news).getByText("Install from this repo", { selector: "summary" });
    expect(repoSummary.getAttribute("aria-label")).toBe("Install from this repo: News");

    // No action button on the page is left with a bare, ambiguous verb.
    const bare = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "")
      .filter((name) => /^(Install|Enable|Disable|Uninstall)$/.test(name.trim()));
    expect(bare).toEqual([]);
  });

  it("uses text + icon badges for featured and install state, not emoji", async () => {
    mockAuth = { token: "tok", isAuthenticated: true, role: "user", sessionKey: 1 };
    routeApi({
      catalog: () => ({ plugins: [{ ...WEATHER, featured: true }], total: 1 }),
      installations: () => ({ installations: [installation("w", true)], count: 1 }),
    });
    const { container } = renderAt();
    const card = (await screen.findByRole("heading", { name: "Weather" })).closest("section")!;
    await within(card).findByRole("button", { name: "Disable Weather" });

    const featured = card.querySelector("[data-status-badge='Featured']")!;
    expect(featured.textContent).toBe("Featured");
    expect(featured.querySelector("svg")).toBeTruthy();
    const installState = card.querySelector("[data-status-badge='Enabled']")!;
    expect(installState.textContent).toBe("Your install: Enabled");
    // The badge sits beside the title, so the heading's name is just the plugin.
    expect(screen.getByRole("heading", { level: 3, name: "Weather" })).toBeTruthy();
    expect(container.textContent).not.toMatch(/[⭐✓✅]/u);
  });

  it("nests plugin cards (h3) under the page's h2 sections", async () => {
    routeApi({
      featured: () => ({ plugins: [NEWS], total: 1 }),
      catalog: () => ({ plugins: [WEATHER, NEWS], total: 2 }),
    });
    renderAt();
    await screen.findByRole("heading", { level: 2, name: "Featured" });
    await screen.findByRole("heading", { level: 3, name: "Weather" });

    const levels = screen
      .getAllByRole("heading")
      .map((h) => `${h.tagName}:${h.textContent?.trim()}`);
    expect(levels).toEqual([
      "H1:Discover plugins",
      "H2:Featured",
      "H3:News",
      "H2:All plugins",
      "H3:Weather",
    ]);
  });
});

describe("Discover plugins: recommendation links", () => {
  it("links each recommendation to Discover searched for it, and runs that search", async () => {
    mockAuth = { token: "tok", isAuthenticated: true, role: "user", sessionKey: 1 };
    routeApi({
      catalog: () => ({ plugins: [WEATHER], total: 1 }),
      search: (path) =>
        new URL(path, "http://x").searchParams.get("q") === "News Digest"
          ? { plugins: [{ ...NEWS, display_name: "News Digest" }], total: 1 }
          : { plugins: [], total: 0 },
      installations: () => ({ installations: [installation("w")], count: 1 }),
      recommendations: () => ({
        recommendations: [{ plugin_id: "n", name: "News Digest", score: 1 }],
      }),
    });
    renderAt("/discover?source=first-party");

    const link = await screen.findByRole("link", { name: "News Digest" });
    expect(link.getAttribute("href")).toBe("/discover?q=News+Digest");
    expect(within(link.closest("div")!).getByRole("list")).toBeTruthy();

    fireEvent.click(link);

    await waitFor(() => expect(location).toBe("?q=News+Digest"));
    expect((screen.getByLabelText("Search plugins") as HTMLInputElement).value).toBe(
      "News Digest",
    );
    expect(
      await screen.findByRole("heading", { level: 3, name: "News Digest" }, { timeout: 1500 }),
    ).toBeTruthy();
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/marketplace/plugins/search?q=News%20Digest&limit=20&offset=0",
    );
  });

  it("mirrors typing into ?q= so a shared link reopens the same search", async () => {
    routeApi({ catalog: () => ({ plugins: [WEATHER], total: 1 }) });
    renderAt("/discover?source=first-party");
    await screen.findByRole("heading", { level: 3, name: "Weather" });

    fireEvent.change(screen.getByLabelText("Search plugins"), { target: { value: "wea" } });
    await waitFor(() => expect(location).toBe("?source=first-party&q=wea"));
    expect((screen.getByLabelText("Search plugins") as HTMLInputElement).value).toBe("wea");

    fireEvent.change(screen.getByLabelText("Search plugins"), { target: { value: "" } });
    await waitFor(() => expect(location).toBe("?source=first-party"));
  });
});
