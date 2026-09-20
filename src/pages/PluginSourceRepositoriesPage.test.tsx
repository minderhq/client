import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PluginSourceRepositoriesPage,
  type PluginSourceRepository,
} from "./PluginSourceRepositoriesPage";
import type { Plugin } from "./AvailablePluginsPage";

const apiFetch = vi.fn();
vi.mock("../lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  friendlyErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

let mockAuth = { token: "", isAuthenticated: false, role: "" };
vi.mock("../lib/auth", () => ({
  useAuth: () => mockAuth,
}));
vi.mock("../components/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true), dialog: null }),
}));

function repository(overrides: Partial<PluginSourceRepository> = {}): PluginSourceRepository {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "weather-tools",
    name: "Weather Tools",
    description: "A collection of weather-related plugins.",
    source_url: "https://github.com/example/weather-tools",
    owner: "user-sub-123",
    plugin_count: 2,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

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

/** Routes apiFetch by path so the repositories list, one repository, its
 * plugin list, and the my-installations lookup each resolve independently of
 * call order -- same technique PublicChatConversationsPage.test.tsx uses. */
function installApi(opts: {
  repositories?: PluginSourceRepository[];
  reposTotal?: number;
  reposError?: Error;
  detail?: PluginSourceRepository;
  detailError?: Error;
  plugins?: Plugin[];
  pluginsTotal?: number;
} = {}) {
  const {
    repositories = [],
    reposTotal,
    reposError,
    detail,
    detailError,
    plugins = [],
    pluginsTotal,
  } = opts;
  apiFetch.mockImplementation((path: string) => {
    if (path.includes("/installations/me")) {
      return Promise.resolve({ installations: [], count: 0 });
    }
    if (/\/repositories\/[^/]+\/plugins/.test(path)) {
      return Promise.resolve({
        plugins,
        count: plugins.length,
        total: pluginsTotal ?? plugins.length,
        limit: 20,
        offset: 0,
      });
    }
    if (/\/repositories\/[^/]+$/.test(path)) {
      return detailError ? Promise.reject(detailError) : Promise.resolve(detail);
    }
    // List: /v1/marketplace/repositories?...
    return reposError
      ? Promise.reject(reposError)
      : Promise.resolve({
          repositories,
          count: repositories.length,
          total: reposTotal ?? repositories.length,
          limit: 20,
          offset: 0,
        });
  });
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/plugins/sources" element={<PluginSourceRepositoriesPage />} />
        <Route
          path="/plugins/sources/:repositoryId"
          element={<PluginSourceRepositoriesPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PluginSourceRepositoriesPage", () => {
  afterEach(() => {
    cleanup();
    apiFetch.mockReset();
    mockAuth = { token: "", isAuthenticated: false, role: "" };
  });

  it("lists repositories with their plugin_count and source link", async () => {
    installApi({
      repositories: [
        repository({ id: "r1", name: "Weather Tools", plugin_count: 3 }),
        repository({ id: "r2", name: "Finance Tools", plugin_count: 0, source_url: null }),
      ],
    });
    renderAt("/plugins/sources");

    expect(await screen.findByText("Weather Tools")).toBeTruthy();
    expect(screen.getByText("Finance Tools")).toBeTruthy();
    expect(screen.getByText("3 plugins")).toBeTruthy();
    expect(screen.getByText("0 plugins")).toBeTruthy();
    expect(screen.getByText(/github\.com\/example\/weather-tools/)).toBeTruthy();
  });

  it("shows an empty state when there are no source repositories, without treating it as an error", async () => {
    installApi({ repositories: [] });
    renderAt("/plugins/sources");

    expect(
      await screen.findByText(/No plugin source repositories yet/),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("paginates the repository list with Load more", async () => {
    const first = Array.from({ length: 20 }, (_, i) =>
      repository({ id: `r-${i}`, name: `Repo ${i}` }),
    );
    installApi({ repositories: first, reposTotal: 21 });
    renderAt("/plugins/sources");

    const loadMore = await screen.findByText("Load more");
    apiFetch.mockImplementationOnce(() =>
      Promise.resolve({
        repositories: [repository({ id: "r-last", name: "Last Repo" })],
        count: 1,
        total: 21,
        limit: 20,
        offset: 20,
      }),
    );
    fireEvent.click(loadMore);

    expect(await screen.findByText("Last Repo")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Load more")).toBeNull());
  });

  it("shows one repository's metadata plus the plugins it contributed", async () => {
    installApi({
      detail: repository({ id: "r1", name: "Weather Tools", plugin_count: 1 }),
      plugins: [plugin({ id: "p1", display_name: "Weather" })],
    });
    renderAt("/plugins/sources/r1");

    expect(await screen.findByText("Weather Tools")).toBeTruthy();
    expect(screen.getByText("Plugins from this repository")).toBeTruthy();
    expect(await screen.findByText("Weather")).toBeTruthy();
    expect(screen.getByText("1 plugin")).toBeTruthy();
  });

  it("treats a repository with zero linked plugins as empty, not an error (legacy/ungrouped case)", async () => {
    installApi({
      detail: repository({ id: "r2", name: "Empty Repo", plugin_count: 0 }),
      plugins: [],
    });
    renderAt("/plugins/sources/r2");

    expect(await screen.findByText("Empty Repo")).toBeTruthy();
    expect(
      await screen.findByText("This repository hasn't contributed any plugins yet."),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the backend's 404 message for an unknown repository id", async () => {
    installApi({ detailError: new Error("Repository not found") });
    renderAt("/plugins/sources/does-not-exist");

    expect(await screen.findByText("Repository not found")).toBeTruthy();
  });

  it("links back to the repository list from the detail view", async () => {
    installApi({
      detail: repository({ id: "r1" }),
      plugins: [],
    });
    renderAt("/plugins/sources/r1");

    const back = await screen.findByText("All sources");
    expect(back.closest("a")?.getAttribute("href")).toBe("/plugins/sources");
  });
});
