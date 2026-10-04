// Browse's source badge + source filter (#2193, #2223), against a real router so the
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
// A first-party row whose manifest names a repo outside minderhq/plugins: the
// #2193 URL heuristic called this "Private git"; its origin says First-party.
const THIRD_PARTY_REPO = plugin({
  id: "2",
  name: "crm",
  display_name: "Internal CRM",
  repository_url: "https://git.example.com/team/crm",
});
const SUBMITTED = plugin({ id: "3", name: "jokes", display_name: "Jokes", origin: "submitted" });
const UNKNOWN = plugin({ id: "4", name: "legacy", display_name: "Legacy", origin: undefined });

/** Catalog paths requested so far (list + search, not Featured). */
function catalogPaths(): string[] {
  return apiFetch.mock.calls
    .map(([path]) => String(path))
    .filter((path) => path.startsWith("/v1/marketplace/plugins") && !path.includes("/featured"));
}

/** A catalog backend. `honoursOrigin` (default): one with #2219, applying the
 * `origin` filter server-side. `false`: an older marketplace, which ignores
 * the unknown param and returns every origin. */
function mockCatalog(
  plugins: CatalogPlugin[],
  featured: CatalogPlugin[] = [],
  { honoursOrigin = true }: { honoursOrigin?: boolean } = {},
) {
  apiFetch.mockImplementation((path: string) => {
    if (path.startsWith("/v1/marketplace/plugins/featured"))
      return Promise.resolve({ plugins: featured, total: featured.length });
    if (path.startsWith("/v1/marketplace/plugins")) {
      const origin = new URL(path, "http://x").searchParams.get("origin");
      const rows =
        honoursOrigin && origin ? plugins.filter((p) => p.origin === origin) : plugins;
      return Promise.resolve({ plugins: rows, total: rows.length });
    }
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

/** Plugin card titles: cards are h3s under the page's h2 sections (#2195). */
function headings() {
  return screen.queryAllByRole("heading", { level: 3 }).map((h) => h.textContent?.trim());
}

afterEach(() => {
  cleanup();
  apiFetch.mockReset();
  location = "";
});

describe("Browse source badges", () => {
  it("badges each card from its catalog origin, never from its repository URL", async () => {
    mockCatalog([FIRST, THIRD_PARTY_REPO, SUBMITTED, UNKNOWN]);
    renderAt("/plugins/available");

    await screen.findByText("Weather");
    const badgeOf = (name: string) => {
      const card = screen.getByRole("heading", { name }).closest("section")!;
      return Array.from(card.querySelectorAll("[data-source]")).map((b) =>
        b.getAttribute("data-source"),
      );
    };
    expect(badgeOf("Weather")).toEqual(["first_party"]);
    expect(badgeOf("Internal CRM")).toEqual(["first_party"]);
    expect(badgeOf("Jokes")).toEqual(["submitted"]);
    const firstParty = screen
      .getByRole("heading", { name: "Weather" })
      .closest("section")!
      .querySelector("[data-source]")!;
    expect(firstParty.textContent).toMatch(/^Source: First-party \(/);
    // no origin: nothing to go on, so no badge rather than a guess
    expect(badgeOf("Legacy")).toEqual([]);
  });

  it("offers a source legend explaining only the sources a listing can have", async () => {
    mockCatalog([FIRST]);
    renderAt("/plugins/available");
    const summary = await screen.findByText("What do the source badges mean?");
    const terms = Array.from(summary.closest("details")!.querySelectorAll("dt")).map(
      (dt) => dt.textContent,
    );
    expect(terms).toEqual(["First-party", "Submitted on this instance"]);
  });

  it("shows the listed version on Browse cards", async () => {
    mockCatalog([plugin({ id: "1", display_name: "Weather", current_version: "3.2.1" })]);
    renderAt("/plugins/available");

    const card = (await screen.findByRole("heading", { name: "Weather" })).closest("section")!;
    expect(within(card).getByText("v3.2.1")).toBeTruthy();
  });
});

describe("Browse source filter", () => {
  it("offers All / First-party / Submitted", async () => {
    mockCatalog([FIRST]);
    renderAt("/plugins/available");

    const select = (await screen.findByLabelText("Filter by source")) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.text)).toEqual([
      "All sources",
      "First-party",
      "Submitted on this instance",
    ]);
    expect(select.value).toBe("");
  });

  it("filters server-side with the origin param and records the choice in ?source=", async () => {
    mockCatalog([FIRST, THIRD_PARTY_REPO, SUBMITTED]);
    renderAt("/plugins/available");
    await screen.findByText("Weather");
    expect(catalogPaths().every((p) => !p.includes("origin="))).toBe(true);

    fireEvent.change(screen.getByLabelText("Filter by source"), {
      target: { value: "submitted" },
    });

    await waitFor(() => expect(headings()).toEqual(["Jokes"]));
    expect(location).toBe("?source=submitted");
    // A fresh first page, asked for by origin (so it covers every page).
    expect(catalogPaths().at(-1)).toBe(
      "/v1/marketplace/plugins?limit=20&offset=0&origin=submitted",
    );
    // The server applied it, so there's no "loaded pages only" caveat.
    expect(screen.queryByText(/can't filter by source/)).toBeNull();
    expect(screen.getByLabelText("Filter by source").getAttribute("aria-describedby")).toBeNull();
  });

  it("sends the origin param with a search too", async () => {
    mockCatalog([FIRST, SUBMITTED]);
    renderAt("/plugins/available?q=we&source=first-party");

    await screen.findByText("Weather");
    expect(catalogPaths().at(-1)).toBe(
      "/v1/marketplace/plugins/search?q=we&limit=20&offset=0&origin=first_party",
    );
  });

  it("restores the filter from a shared URL", async () => {
    mockCatalog([FIRST, THIRD_PARTY_REPO, SUBMITTED]);
    renderAt("/plugins/available?source=submitted");

    await screen.findByText("Jokes");
    expect(headings()).toEqual(["Jokes"]);
    expect((screen.getByLabelText("Filter by source") as HTMLSelectElement).value).toBe("submitted");
    expect(catalogPaths().every((p) => p.endsWith("&origin=submitted"))).toBe(true);
  });

  it("clears ?source= on All, keeping other params", async () => {
    mockCatalog([FIRST, SUBMITTED]);
    renderAt("/plugins/available?q=crm&source=submitted");
    await screen.findByText("Jokes");

    fireEvent.change(screen.getByLabelText("Filter by source"), { target: { value: "" } });

    await waitFor(() => expect(location).toBe("?q=crm"));
    await waitFor(() => expect(catalogPaths().at(-1)).not.toContain("origin="));
  });

  it.each(["bogus", "private", "manifest"])(
    "treats ?source=%s as All (old Private git links included)",
    async (value) => {
      mockCatalog([FIRST, THIRD_PARTY_REPO]);
      renderAt(`/plugins/available?source=${value}`);

      await screen.findByText("Weather");
      expect(headings()).toEqual(["Weather", "Internal CRM"]);
      expect((screen.getByLabelText("Filter by source") as HTMLSelectElement).value).toBe("");
      expect(catalogPaths().every((p) => !p.includes("origin="))).toBe(true);
    },
  );

  it("applies to Featured too, and says when nothing matches", async () => {
    mockCatalog([FIRST], [plugin({ id: "9", display_name: "Featured First", featured: true })]);
    renderAt("/plugins/available?source=submitted");

    expect(await screen.findByText("No plugins match the selected filters.")).toBeTruthy();
    expect(screen.queryByText("Featured First")).toBeNull();
    expect(screen.queryByText("Weather")).toBeNull();
  });

  describe("on a marketplace without the origin filter (older backend)", () => {
    it("still filters the loaded pages client-side and says that's all it covers", async () => {
      mockCatalog([FIRST, THIRD_PARTY_REPO, SUBMITTED], [], { honoursOrigin: false });
      renderAt("/plugins/available?source=submitted");

      await waitFor(() => expect(headings()).toEqual(["Jokes"]));
      const hint = screen.getByText(/This server can't filter by source/);
      expect(hint.textContent).toContain("only covers the plugins loaded so far");
      // The select points at the caveat, so a screen reader hears it on focus.
      expect(screen.getByLabelText("Filter by source").getAttribute("aria-describedby")).toBe(
        hint.id,
      );
    });

    it("explains an empty filtered page instead of claiming the catalog has none", async () => {
      mockCatalog([FIRST], [], { honoursOrigin: false });
      renderAt("/plugins/available?source=submitted");

      expect(
        await screen.findByText("No plugins on this page match the selected filters."),
      ).toBeTruthy();
      expect(screen.getByText(/This server can't filter by source/)).toBeTruthy();
    });
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
