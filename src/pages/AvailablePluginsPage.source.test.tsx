// Browse's source badge + source filter (#2193), against a real router so the
// ?source= URL state is exercised end to end (AvailablePluginsPage.test.tsx
// stubs react-router-dom, which can't observe the URL).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CatalogPlugin } from "../lib/marketplace";
import { AvailablePluginsPage, PluginCard } from "./AvailablePluginsPage";

const apiFetch = vi.fn();
vi.mock("../lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  friendlyErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
}));
vi.mock("../lib/auth", () => ({
  useAuth: () => ({ token: "", isAuthenticated: false, role: null, sessionKey: 0 }),
}));
vi.mock("../components/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: vi.fn(), dialog: null }),
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

const FIRST = plugin({ id: "1", name: "weather", display_name: "Weather" });
const PRIVATE = plugin({
  id: "2",
  name: "crm",
  display_name: "Internal CRM",
  repository_url: "https://git.example.com/team/crm",
});
const SUBMITTED = plugin({ id: "3", name: "jokes", display_name: "Jokes", origin: "submitted" });
const UNKNOWN = plugin({ id: "4", name: "legacy", display_name: "Legacy", origin: undefined });

function mockCatalog(plugins: CatalogPlugin[], featured: CatalogPlugin[] = []) {
  apiFetch.mockImplementation((path: string) => {
    if (path.startsWith("/v1/marketplace/plugins/featured"))
      return Promise.resolve({ plugins: featured, total: featured.length });
    if (path.startsWith("/v1/marketplace/plugins"))
      return Promise.resolve({ plugins, total: plugins.length });
    return Promise.resolve({});
  });
}

let location = "";
function LocationProbe() {
  const loc = useLocation();
  location = loc.search;
  return null;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/plugins/available"
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

function headings() {
  return screen.queryAllByRole("heading", { level: 2 }).map((h) => h.textContent?.trim());
}

afterEach(() => {
  cleanup();
  apiFetch.mockReset();
  location = "";
});

describe("Browse source badges", () => {
  it("puts exactly one source badge on each classifiable card", async () => {
    mockCatalog([FIRST, PRIVATE, SUBMITTED, UNKNOWN]);
    renderAt("/plugins/available");

    await screen.findByText("Weather");
    const badgeOf = (name: string) => {
      const card = screen.getByRole("heading", { name }).closest("section")!;
      return Array.from(card.querySelectorAll("[data-source]")).map((b) =>
        b.getAttribute("data-source"),
      );
    };
    expect(badgeOf("Weather")).toEqual(["first_party"]);
    expect(badgeOf("Internal CRM")).toEqual(["private_git"]);
    expect(badgeOf("Jokes")).toEqual(["submitted"]);
    const firstParty = screen
      .getByRole("heading", { name: "Weather" })
      .closest("section")!
      .querySelector("[data-source]")!;
    expect(firstParty.textContent).toMatch(/^Source: First-party \(/);
    // no origin, no repository: nothing to go on, so no badge rather than a guess
    expect(badgeOf("Legacy")).toEqual([]);
  });

  it("offers the source legend next to the filters", async () => {
    mockCatalog([FIRST]);
    renderAt("/plugins/available");
    expect(await screen.findByText("What do the source badges mean?")).toBeTruthy();
  });

  it("shows the listed version on Browse cards", async () => {
    mockCatalog([plugin({ id: "1", display_name: "Weather", current_version: "3.2.1" })]);
    renderAt("/plugins/available");

    const card = (await screen.findByRole("heading", { name: "Weather" })).closest("section")!;
    expect(within(card).getByText("v3.2.1")).toBeTruthy();
  });
});

describe("Browse source filter", () => {
  it("offers All / First-party / Private git / Submitted", async () => {
    mockCatalog([FIRST]);
    renderAt("/plugins/available");

    const select = (await screen.findByLabelText("Filter by source")) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.text)).toEqual([
      "All sources",
      "First-party",
      "Private git",
      "Submitted on this instance",
    ]);
    expect(select.value).toBe("");
  });

  it("filters the loaded list client-side and records the choice in ?source=", async () => {
    mockCatalog([FIRST, PRIVATE, SUBMITTED]);
    renderAt("/plugins/available");
    await screen.findByText("Weather");
    const catalogCalls = apiFetch.mock.calls.length;

    fireEvent.change(screen.getByLabelText("Filter by source"), { target: { value: "private" } });

    await waitFor(() => expect(headings()).toEqual(["Internal CRM"]));
    expect(location).toBe("?source=private");
    // client-side: no new catalog request for a source change
    expect(apiFetch.mock.calls.length).toBe(catalogCalls);
  });

  it("restores the filter from a shared URL", async () => {
    mockCatalog([FIRST, PRIVATE, SUBMITTED]);
    renderAt("/plugins/available?source=submitted");

    await screen.findByText("Jokes");
    expect(headings()).toEqual(["Jokes"]);
    expect((screen.getByLabelText("Filter by source") as HTMLSelectElement).value).toBe("submitted");
  });

  it("clears ?source= on All, keeping other params", async () => {
    mockCatalog([FIRST, PRIVATE]);
    renderAt("/plugins/available?q=crm&source=private");
    await screen.findByText("Internal CRM");

    fireEvent.change(screen.getByLabelText("Filter by source"), { target: { value: "" } });

    await waitFor(() => expect(location).toBe("?q=crm"));
  });

  it("treats an unknown ?source= value as All", async () => {
    mockCatalog([FIRST, PRIVATE]);
    renderAt("/plugins/available?source=bogus");

    await screen.findByText("Weather");
    expect(headings()).toEqual(["Weather", "Internal CRM"]);
    expect((screen.getByLabelText("Filter by source") as HTMLSelectElement).value).toBe("");
  });

  it("applies to Featured too, and explains an empty filtered page", async () => {
    mockCatalog([FIRST], [plugin({ id: "9", display_name: "Featured First", featured: true })]);
    renderAt("/plugins/available?source=private");

    expect(
      await screen.findByText("No plugins on this page match the selected filters."),
    ).toBeTruthy();
    expect(screen.queryByText("Featured First")).toBeNull();
    expect(screen.queryByText("Weather")).toBeNull();
  });
});

describe("PluginCard version hint", () => {
  it("hints when the caller's installed version is older than the listing", () => {
    render(
      <MemoryRouter>
        <PluginCard
          plugin={plugin({ id: "1", display_name: "Weather", current_version: "2.0.0" })}
          installation={{
            installation_id: "i",
            plugin_id: "1",
            version: "1.0.0",
            status: "installed",
            enabled: true,
            installed_at: "2026-01-01T00:00:00Z",
            last_updated_at: "2026-01-01T00:00:00Z",
            name: "p",
            display_name: "Weather",
            description: null,
            current_version: "2.0.0",
            pricing_model: "free",
            base_tier: "community",
            category_id: null,
            author: null,
            requires_services: [],
          }}
          token="tok"
          isAuthenticated
          onInstalled={vi.fn()}
          onUninstalled={vi.fn()}
          onToggleEnabled={vi.fn()}
          confirm={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("v2.0.0")).toBeTruthy();
    expect(screen.getByText("You have v1.0.0 · newer version listed")).toBeTruthy();
  });
});
