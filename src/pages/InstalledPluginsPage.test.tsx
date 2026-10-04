import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mergeInstalledPlugins } from "../lib/installedPlugins";
import type { CatalogPlugin, RuntimePlugin } from "../lib/marketplace";
import type { Installation } from "../lib/types";
import {
  ConfigurePanel,
  InstalledPluginCard,
  InstalledPluginsPage,
} from "./InstalledPluginsPage";

const apiFetch = vi.fn();
let mockAuth = { token: "tok", isAuthenticated: true };

vi.mock("../lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  friendlyErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
}));
vi.mock("../lib/auth", () => ({
  useAuth: () => mockAuth,
}));
const mockConfirm = vi.fn();
vi.mock("../components/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: mockConfirm, dialog: null }),
}));
vi.mock("react-router-dom", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

function installation(overrides: Partial<Installation> = {}): Installation {
  return {
    installation_id: "inst-1",
    plugin_id: "plugin-1",
    version: "1.0.0",
    status: "active",
    enabled: true,
    installed_at: "2026-01-01T00:00:00Z",
    last_updated_at: "2026-01-01T00:00:00Z",
    name: "my-plugin",
    display_name: "My Plugin",
    description: null,
    current_version: "1.0.0",
    pricing_model: "free",
    base_tier: "free",
    category_id: null,
    author: null,
    requires_services: [],
    ...overrides,
  };
}

/** A card entry for a plugin that only has a marketplace install record. */
function entryOf(inst: Installation) {
  return mergeInstalledPlugins([inst], null, null)[0];
}

afterEach(() => {
  cleanup();
  apiFetch.mockReset();
  mockConfirm.mockReset();
  mockAuth = { token: "tok", isAuthenticated: true };
});

interface Api {
  installations?: Installation[] | Error | Promise<unknown>;
  runtime?: RuntimePlugin[] | Error | Promise<unknown>;
  catalog?: CatalogPlugin[] | Error | Promise<unknown>;
}

/** Routes the three Installed-page reads by path; anything else (the lifecycle
 * mutations) resolves to `{}`. */
function mockApi({ installations = [], runtime = [], catalog = [] }: Api) {
  const answer = (v: unknown, wrap: (x: unknown[]) => unknown) =>
    v instanceof Error
      ? Promise.reject(v)
      : v instanceof Promise
        ? v
        : Promise.resolve(wrap(v as unknown[]));
  apiFetch.mockImplementation((path: string) => {
    if (path === "/v1/marketplace/installations/me")
      return answer(installations, (x) => ({ installations: x, count: x.length }));
    if (path.startsWith("/v1/plugins?"))
      return answer(runtime, (x) => ({ plugins: x, count: x.length, total: x.length, limit: 500, offset: 0 }));
    if (path.startsWith("/v1/marketplace/plugins?"))
      return answer(catalog, (x) => ({ plugins: x, count: x.length, total: x.length, limit: 100, offset: 0 }));
    return Promise.resolve({});
  });
}

function runtimePlugin(overrides: Partial<RuntimePlugin> = {}): RuntimePlugin {
  return {
    name: "weather",
    version: "2.1.0",
    description: "Weather data",
    author: "Minder",
    status: "enabled",
    enabled: true,
    dependencies: [],
    capabilities: [],
    data_sources: [],
    databases: [],
    registered_at: "2026-01-01T00:00:00Z",
    health_status: "healthy",
    last_health_check: "2026-01-01T00:05:00Z",
    ...overrides,
  };
}

function catalogRow(overrides: Partial<CatalogPlugin> = {}): CatalogPlugin {
  return {
    id: "cat-weather",
    name: "weather",
    display_name: "Weather",
    description: null,
    author: "Minder",
    repository_url: null,
    distribution_type: "git",
    docker_image: null,
    current_version: "2.1.0",
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

// The fixtures above are pre-#2219 shapes (an older backend). These are the
// same payloads from a backend with #2219's fields.
function runtimeNew(overrides: Partial<RuntimePlugin> = {}): RuntimePlugin {
  return runtimePlugin({
    install_source: "vendored",
    repository_url: null,
    marketplace_plugin_id: "cat-weather",
    configurable: true,
    ...overrides,
  });
}

function installationNew(overrides: Partial<Installation> = {}): Installation {
  return installation({ origin: "first_party", repository_url: null, ...overrides });
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function cardFor(name: string): HTMLElement {
  return screen.getByRole("heading", { name }).closest("section")!;
}

describe("InstalledPluginsPage", () => {
  it("prompts to log in and never fetches when not authenticated", async () => {
    mockAuth = { token: "", isAuthenticated: false };
    render(<InstalledPluginsPage />);

    expect(
      await screen.findByText("Log in (top right) to see your installed plugins."),
    ).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("fetches installations and the runtime list in parallel -- never the catalog -- from a #2219 backend", async () => {
    mockApi({ installations: [installationNew()], runtime: [runtimeNew()] });
    render(<InstalledPluginsPage />);

    await screen.findByRole("heading", { name: "My Plugin" });
    const paths = apiFetch.mock.calls.map((c) => c[0]);
    expect(paths).toEqual(["/v1/marketplace/installations/me", "/v1/plugins?limit=500&offset=0"]);
    for (const call of apiFetch.mock.calls) expect(call[1]).toMatchObject({ token: "tok" });
  });

  it("doesn't fetch the catalog when nothing is installed or running", async () => {
    mockApi({});
    render(<InstalledPluginsPage />);

    await screen.findByText("find one in Discover plugins");
    expect(apiFetch.mock.calls.map((c) => c[0])).toEqual([
      "/v1/marketplace/installations/me",
      "/v1/plugins?limit=500&offset=0",
    ]);
  });

  it.each([
    ["registry", { installations: [installationNew()], runtime: [runtimePlugin()] }],
    ["marketplace", { installations: [installation()], runtime: [runtimeNew()] }],
  ])(
    "falls back to the catalog when the %s predates #2219",
    async (_service, api) => {
      mockApi({ ...api, catalog: [catalogRow()] });
      render(<InstalledPluginsPage />);

      await screen.findByRole("heading", { name: "Weather" });
      expect(apiFetch.mock.calls.map((c) => c[0])).toEqual([
        "/v1/marketplace/installations/me",
        "/v1/plugins?limit=500&offset=0",
        "/v1/marketplace/plugins?limit=100&offset=0",
      ]);
    },
  );

  it("shows an empty state with a link to Discover plugins when nothing is installed or running", async () => {
    mockApi({});
    render(<InstalledPluginsPage />);

    expect(await screen.findByText("find one in Discover plugins")).toBeTruthy();
  });

  it("shows a loading state -- never the empty state -- until every request settles (#2195)", async () => {
    const runtime = deferred<unknown>();
    mockApi({ runtime: runtime.promise });
    render(<InstalledPluginsPage />);

    expect(screen.getByText("Loading installed plugins…")).toBeTruthy();
    // installations have answered (empty); runtime hasn't yet.
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(screen.queryByText("find one in Discover plugins")).toBeNull();

    runtime.resolve({ plugins: [], total: 0 });
    expect(await screen.findByText("find one in Discover plugins")).toBeTruthy();
    expect(screen.queryByText("Loading installed plugins…")).toBeNull();
  });

  it("renders installed plugin cards and the Installed AI tools cross-link when non-empty", async () => {
    mockApi({ installations: [installation()] });
    render(<InstalledPluginsPage />);

    expect(await screen.findByText("My Plugin")).toBeTruthy();
    expect(screen.getByText("check Installed AI tools")).toBeTruthy();
  });

  it("lists a runtime-loaded first-party plugin that has no marketplace install (#2193)", async () => {
    mockApi({ runtime: [runtimePlugin()], catalog: [catalogRow()] });
    render(<InstalledPluginsPage />);

    expect(await screen.findByRole("heading", { name: "Weather" })).toBeTruthy();
    const card = cardFor("Weather");
    expect(within(card).getByText("First-party")).toBeTruthy();
    expect(within(card).getByText("Enabled on this installation")).toBeTruthy();
    expect(within(card).getByText(/Health: healthy/)).toBeTruthy();
    // last-check time is visible text, not a hover-only tooltip
    const checked = within(card).getByText(/Health checked/);
    expect(checked.querySelector("time")?.getAttribute("dateTime")).toBe("2026-01-01T00:05:00Z");
    expect(card.querySelector("[title^='Last health check']")).toBeNull();
    expect(within(card).getByText("v2.1.0")).toBeTruthy();
    expect(within(card).getByText(/no marketplace install/)).toBeTruthy();
    // Nothing for the marketplace lifecycle endpoints to act on.
    expect(within(card).queryByRole("button", { name: /Uninstall/ })).toBeNull();
    expect(within(card).queryByRole("button", { name: /Enable|Disable/ })).toBeNull();
    // ...but its settings are still reachable.
    expect(within(card).getByText("Configure")).toBeTruthy();
  });

  it("shows a runtime-only plugin with no catalog row without guessing its source", async () => {
    mockApi({ runtime: [runtimePlugin({ name: "from-git", health_status: "unknown", last_health_check: null })] });
    render(<InstalledPluginsPage />);

    const heading = await screen.findByRole("heading", { name: "from-git" });
    const card = heading.closest("section")!;
    expect(card.querySelector("[data-source]")).toBeNull();
    expect(within(card).getByText(/Health: unknown/)).toBeTruthy();
    expect(within(card).getByText("No health check yet")).toBeTruthy();
  });

  it("merges a marketplace install with its runtime entry into ONE card", async () => {
    mockApi({
      installations: [
        installation({ plugin_id: "cat-weather", name: "weather", display_name: "Weather", version: null }),
      ],
      runtime: [runtimePlugin()],
      catalog: [catalogRow()],
    });
    render(<InstalledPluginsPage />);

    await screen.findByRole("heading", { name: "Weather" });
    expect(screen.getAllByRole("heading", { name: "Weather" })).toHaveLength(1);
    const card = cardFor("Weather");
    expect(within(card).getByText("Enabled on this installation")).toBeTruthy();
    expect(within(card).getByText("Your install: Enabled")).toBeTruthy();
    // the running version, even though the install record has none
    expect(within(card).getByText("v2.1.0")).toBeTruthy();
    expect(within(card).getByRole("button", { name: /Uninstall/ })).toBeTruthy();
  });

  it("says when an installed plugin isn't running on this installation", async () => {
    mockApi({ installations: [installation()], runtime: [runtimePlugin()] });
    render(<InstalledPluginsPage />);

    await screen.findByRole("heading", { name: "My Plugin" });
    expect(
      within(cardFor("My Plugin")).getByText("Not running on this installation"),
    ).toBeTruthy();
  });

  it("shows a quiet hint when the catalog lists a newer version than the installed one", async () => {
    mockApi({
      installations: [installation({ version: "1.0.0", current_version: "1.0.0" })],
      catalog: [catalogRow({ id: "plugin-1", name: "my-plugin", display_name: "My Plugin", current_version: "1.1.0" })],
    });
    render(<InstalledPluginsPage />);

    await screen.findByRole("heading", { name: "My Plugin" });
    const card = cardFor("My Plugin");
    expect(within(card).getByText("v1.0.0")).toBeTruthy();
    expect(within(card).getByText("Newer version listed: v1.1.0")).toBeTruthy();
  });

  it("keeps the runtime list when the installations fetch fails, and says what failed", async () => {
    mockApi({ installations: new Error("marketplace unreachable"), runtime: [runtimePlugin()] });
    render(<InstalledPluginsPage />);

    expect(
      await screen.findByText("Couldn't load your marketplace installs: marketplace unreachable"),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "weather" })).toBeTruthy();
    expect(screen.queryByText("find one in Discover plugins")).toBeNull();
  });

  it("keeps the installations when the runtime list fails, without claiming 'not running'", async () => {
    mockApi({ installations: [installation()], runtime: new Error("plugin-registry unreachable") });
    render(<InstalledPluginsPage />);

    expect(
      await screen.findByText(
        "Couldn't load the plugins running on this installation: plugin-registry unreachable",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "My Plugin" })).toBeTruthy();
    expect(screen.queryByText("Not running on this installation")).toBeNull();
  });

  it("shows both errors and no empty state when both lists fail, and retries on request", async () => {
    mockApi({ installations: new Error("marketplace unreachable"), runtime: new Error("registry down") });
    render(<InstalledPluginsPage />);

    expect(await screen.findByText(/marketplace unreachable/)).toBeTruthy();
    expect(screen.getByText(/registry down/)).toBeTruthy();
    expect(screen.queryByText("find one in Discover plugins")).toBeNull();

    mockApi({ installations: [installation()] });
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(await screen.findByRole("heading", { name: "My Plugin" })).toBeTruthy();
    expect(screen.queryByText(/marketplace unreachable/)).toBeNull();
  });

  it("still lists everything when only the catalog fails, minus source/listed-version details", async () => {
    mockApi({ runtime: [runtimePlugin()], catalog: new Error("catalog down") });
    render(<InstalledPluginsPage />);

    await screen.findByRole("heading", { name: "weather" });
    expect(screen.getByText(/Source and listed-version details are unavailable/)).toBeTruthy();
    expect(document.querySelector("[data-source]")).toBeNull();
  });

  it("says when the catalog was cut short by the page cap", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/v1/marketplace/plugins?"))
        return Promise.resolve({ plugins: Array(100).fill(catalogRow()), total: 5000 });
      if (path.startsWith("/v1/plugins?"))
        return Promise.resolve({ plugins: [runtimePlugin()], total: 1 });
      return Promise.resolve({ installations: [], count: 0 });
    });
    render(<InstalledPluginsPage />);

    expect(
      await screen.findByText(
        "Only part of the catalog could be loaded, so some source badges and listed versions may be missing.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Weather" })).toBeTruthy();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("doesn't claim 'not running' when the runtime list was cut short", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/v1/plugins?"))
        return Promise.resolve({ plugins: Array(500).fill(runtimePlugin()), total: 1_000_000 });
      if (path.startsWith("/v1/marketplace/plugins?"))
        return Promise.resolve({ plugins: [], total: 0 });
      return Promise.resolve({ installations: [installation()], count: 1 });
    });
    render(<InstalledPluginsPage />);

    expect(
      await screen.findByText(/Only part of the runtime plugin list could be loaded/),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "My Plugin" })).toBeTruthy();
    expect(screen.queryByText("Not running on this installation")).toBeNull();
    warn.mockRestore();
  });

  it("treats a response that omits `installations` as an empty list, not a crash", async () => {
    apiFetch.mockResolvedValue({ count: 0 });
    render(<InstalledPluginsPage />);

    expect(await screen.findByText("find one in Discover plugins")).toBeTruthy();
  });

  it("removes an uninstalled plugin from the list without a re-fetch", async () => {
    mockConfirm.mockResolvedValue(true);
    mockApi({ installations: [installation()] });
    render(<InstalledPluginsPage />);

    expect(await screen.findByText("My Plugin")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Uninstall/ }));

    await waitFor(() => expect(screen.queryByText("My Plugin")).toBeNull());
    expect(await screen.findByText("find one in Discover plugins")).toBeTruthy();
    expect(apiFetch).toHaveBeenCalledTimes(4); // 3 loads + the DELETE, no reload
  });

  it("keeps a plugin listed after uninstall when the installation still runs it", async () => {
    mockConfirm.mockResolvedValue(true);
    mockApi({
      installations: [installation({ plugin_id: "cat-weather", name: "weather", display_name: "Weather" })],
      runtime: [runtimePlugin()],
      catalog: [catalogRow()],
    });
    render(<InstalledPluginsPage />);

    await screen.findByRole("heading", { name: "Weather" });
    fireEvent.click(screen.getByRole("button", { name: /Uninstall/ }));

    await waitFor(() => expect(screen.queryByRole("button", { name: /Uninstall/ })).toBeNull());
    const card = cardFor("Weather");
    expect(within(card).getByText("Enabled on this installation")).toBeTruthy();
    expect(within(card).getByText(/no marketplace install/)).toBeTruthy();
  });
});

describe("InstalledPluginsPage with #2219's fields", () => {
  function badgeOf(card: HTMLElement) {
    return Array.from(card.querySelectorAll("[data-source]")).map((b) => b.getAttribute("data-source"));
  }

  it("badges each running plugin by how it was installed", async () => {
    mockApi({
      runtime: [
        runtimeNew({ name: "weather" }),
        runtimeNew({
          name: "crm",
          install_source: "git",
          repository_url: "https://git.example.com/team/crm",
          marketplace_plugin_id: null,
        }),
        runtimeNew({ name: "hook", install_source: "manifest", marketplace_plugin_id: null }),
        runtimeNew({ name: "fresh", install_source: null, marketplace_plugin_id: null }),
      ],
    });
    render(<InstalledPluginsPage />);

    await screen.findByRole("heading", { name: "weather" });
    expect(badgeOf(cardFor("weather"))).toEqual(["first_party"]);
    expect(badgeOf(cardFor("crm"))).toEqual(["private_git"]);
    expect(badgeOf(cardFor("hook"))).toEqual(["manifest"]);
    expect(badgeOf(cardFor("fresh"))).toEqual([]); // null: no badge, no guess
    // The new variant's accessible name and in-place explanation.
    expect(cardFor("hook").querySelector("[data-source]")!.textContent).toBe(
      "Source: Manifest upload (Installed on this installation by uploading its plugin manifest.)",
    );
    // No catalog: no catalog notices either.
    expect(screen.queryByText(/Source and listed-version details/)).toBeNull();
    expect(screen.queryByText(/Only part of the catalog/)).toBeNull();
  });

  it("explains the Manifest upload badge in the source legend", async () => {
    mockApi({ runtime: [runtimeNew()] });
    render(<InstalledPluginsPage />);

    const summary = await screen.findByText("What do the source badges mean?");
    const terms = Array.from(summary.closest("details")!.querySelectorAll("dt")).map(
      (dt) => dt.textContent,
    );
    expect(terms).toContain("Manifest upload");
  });

  it("badges an installation-only plugin from its origin", async () => {
    mockApi({ installations: [installationNew({ origin: "submitted" })], runtime: [] });
    render(<InstalledPluginsPage />);

    await screen.findByRole("heading", { name: "My Plugin" });
    expect(badgeOf(cardFor("My Plugin"))).toEqual(["submitted"]);
  });

  it("merges a runtime plugin with the caller's install of its catalog row by id", async () => {
    mockApi({
      installations: [
        installationNew({ plugin_id: "cat-weather", name: "weather-renamed", display_name: "Weather" }),
      ],
      runtime: [runtimeNew()],
    });
    render(<InstalledPluginsPage />);

    await screen.findByRole("heading", { name: "Weather" });
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(1);
    const card = cardFor("Weather");
    expect(within(card).getByText("Enabled on this installation")).toBeTruthy();
    expect(within(card).getByText("Your install: Enabled")).toBeTruthy();
  });

  it("keeps a git install and a same-named submission apart (the #2193 collision)", async () => {
    mockApi({
      installations: [
        installationNew({
          plugin_id: "cat-jokes",
          name: "jokes",
          display_name: "Jokes (submitted)",
          origin: "submitted",
          current_version: "9.0.0",
          version: "9.0.0",
        }),
      ],
      runtime: [
        runtimeNew({ name: "jokes", version: "0.1.0", install_source: "git", marketplace_plugin_id: null }),
      ],
    });
    render(<InstalledPluginsPage />);

    await screen.findByRole("heading", { name: "jokes" });
    const running = cardFor("jokes");
    expect(badgeOf(running)).toEqual(["private_git"]);
    expect(within(running).getByText("v0.1.0")).toBeTruthy();
    expect(within(running).queryByText(/Newer version listed/)).toBeNull();
    expect(within(running).queryByRole("button", { name: /Uninstall/ })).toBeNull();

    const submitted = cardFor("Jokes (submitted)");
    expect(badgeOf(submitted)).toEqual(["submitted"]);
    expect(within(submitted).getByText("Not running on this installation")).toBeTruthy();
    expect(within(submitted).getByRole("button", { name: "Uninstall Jokes (submitted)" })).toBeTruthy();
  });

  it("keeps the runtime paging-cap notice (that list still pages)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/v1/plugins?"))
        return Promise.resolve({ plugins: Array(500).fill(runtimeNew()), total: 1_000_000 });
      return Promise.resolve({ installations: [], count: 0 });
    });
    render(<InstalledPluginsPage />);

    expect(
      await screen.findByText(/Only part of the runtime plugin list could be loaded/),
    ).toBeTruthy();
    expect(apiFetch.mock.calls.some(([p]) => String(p).startsWith("/v1/marketplace/plugins?"))).toBe(false);
    warn.mockRestore();
  });
});

describe("InstalledPluginCard — accessibility (#2195)", () => {
  it("names every action after the plugin and uses a text + icon install badge", () => {
    render(
      <InstalledPluginCard
        entry={entryOf(installation({ enabled: true }))}
        token="tok"
        onUninstalled={vi.fn()}
        onToggleEnabled={vi.fn()}
        confirm={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { level: 3, name: "My Plugin" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Disable My Plugin" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Uninstall My Plugin" })).toBeTruthy();
    expect(screen.getByText("Configure", { selector: "summary" }).getAttribute("aria-label")).toBe(
      "Configure My Plugin",
    );
    const badge = screen.getByText("Your install: Enabled");
    expect(badge.querySelector("svg")).toBeTruthy();
    expect(badge.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("InstalledPluginCard — enable/disable", () => {
  it("disables an enabled plugin and reports the new state", async () => {
    apiFetch.mockResolvedValue({});
    const onToggleEnabled = vi.fn();
    render(
      <InstalledPluginCard
        entry={entryOf(installation({ enabled: true }))}
        token="tok"
        onUninstalled={vi.fn()}
        onToggleEnabled={onToggleEnabled}
        confirm={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Disable My Plugin" }));

    await waitFor(() =>
      expect(onToggleEnabled).toHaveBeenCalledWith("plugin-1", false),
    );
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/marketplace/plugins/plugin-1/disable",
      { method: "POST", token: "tok" },
    );
  });

  it("enables a disabled plugin and reports the new state", async () => {
    apiFetch.mockResolvedValue({});
    const onToggleEnabled = vi.fn();
    render(
      <InstalledPluginCard
        entry={entryOf(installation({ enabled: false }))}
        token="tok"
        onUninstalled={vi.fn()}
        onToggleEnabled={onToggleEnabled}
        confirm={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Enable My Plugin" }));

    await waitFor(() =>
      expect(onToggleEnabled).toHaveBeenCalledWith("plugin-1", true),
    );
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/marketplace/plugins/plugin-1/enable",
      { method: "POST", token: "tok" },
    );
  });

  it("shows a friendly error and does not report a toggle on failure", async () => {
    apiFetch.mockRejectedValue(new Error("plugin-registry unreachable"));
    const onToggleEnabled = vi.fn();
    render(
      <InstalledPluginCard
        entry={entryOf(installation({ enabled: true }))}
        token="tok"
        onUninstalled={vi.fn()}
        onToggleEnabled={onToggleEnabled}
        confirm={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Disable My Plugin" }));

    await screen.findByText("plugin-registry unreachable");
    expect(onToggleEnabled).not.toHaveBeenCalled();
  });
});

describe("InstalledPluginCard — uninstall", () => {
  it("does not uninstall when the confirmation is declined", async () => {
    const onUninstalled = vi.fn();
    const confirm = vi.fn().mockResolvedValue(false);
    render(
      <InstalledPluginCard
        entry={entryOf(installation())}
        token="tok"
        onUninstalled={onUninstalled}
        onToggleEnabled={vi.fn()}
        confirm={confirm}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Uninstall My Plugin" }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());

    expect(apiFetch).not.toHaveBeenCalled();
    expect(onUninstalled).not.toHaveBeenCalled();
  });

  it("uninstalls the plugin once confirmed", async () => {
    apiFetch.mockResolvedValue({});
    const onUninstalled = vi.fn();
    const confirm = vi.fn().mockResolvedValue(true);
    render(
      <InstalledPluginCard
        entry={entryOf(installation())}
        token="tok"
        onUninstalled={onUninstalled}
        onToggleEnabled={vi.fn()}
        confirm={confirm}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Uninstall My Plugin" }));

    await waitFor(() =>
      expect(onUninstalled).toHaveBeenCalledWith("plugin-1"),
    );
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/marketplace/plugins/plugin-1/uninstall",
      { method: "DELETE", token: "tok" },
    );
  });
});

describe("ConfigurePanel with a known configurable flag (#2219)", () => {
  it("shows a quiet 'No settings available' line -- no disclosure, no request -- when false", () => {
    render(<ConfigurePanel name="my-plugin" displayName="My Plugin" token="tok" configurable={false} />);

    expect(screen.getByText("No settings available for this plugin.")).toBeTruthy();
    expect(screen.queryByText("Configure")).toBeNull();
    expect(document.querySelector("details")).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("offers Configure and loads the schema on expand when true", async () => {
    apiFetch.mockResolvedValue({
      configurable: true,
      schema: [{ key: "greeting", type: "string" }],
      values: { greeting: "hello" },
    });
    render(<ConfigurePanel name="my-plugin" displayName="My Plugin" token="tok" configurable />);
    expect(apiFetch).not.toHaveBeenCalled();

    const summary = screen.getByText("Configure", { selector: "summary" });
    expect(summary.getAttribute("aria-label")).toBe("Configure My Plugin");
    fireEvent.click(summary);

    expect(await screen.findByLabelText("greeting")).toBeTruthy();
    expect(apiFetch).toHaveBeenCalledWith("/v1/plugins/my-plugin/config", { token: "tok" });
  });

  it("still treats a 404 'not running' as no settings when true (a plugin that stopped since the list)", async () => {
    apiFetch.mockRejectedValue(
      Object.assign(new Error("Plugin 'my-plugin' is not running"), { status: 404 }),
    );
    render(<ConfigurePanel name="my-plugin" token="tok" configurable />);

    fireEvent.click(screen.getByText("Configure"));
    expect(await screen.findByText("No settings available for this plugin.")).toBeTruthy();
  });
});

describe("InstalledPluginsPage — Configure from the runtime list", () => {
  function configCalls() {
    return apiFetch.mock.calls.filter(([p]) => String(p).endsWith("/config"));
  }

  it("offers Configure only for plugins the registry says are configurable", async () => {
    mockApi({
      runtime: [
        runtimeNew({ name: "weather", configurable: true }),
        runtimeNew({ name: "jokes", configurable: false, marketplace_plugin_id: null }),
      ],
    });
    render(<InstalledPluginsPage />);

    await screen.findByRole("heading", { name: "weather" });
    expect(within(cardFor("weather")).getByText("Configure", { selector: "summary" })).toBeTruthy();
    const jokes = cardFor("jokes");
    expect(within(jokes).queryByText("Configure")).toBeNull();
    expect(within(jokes).getByText("No settings available for this plugin.")).toBeTruthy();
    expect(configCalls()).toEqual([]);
  });

  it("shows no settings, without a request, for an install that isn't running", async () => {
    // The submission named like the running git plugin: asking
    // /v1/plugins/jokes/config would have read the OTHER plugin's settings.
    mockApi({
      installations: [
        installationNew({ plugin_id: "cat-jokes", name: "jokes", display_name: "Jokes (submitted)", origin: "submitted" }),
      ],
      runtime: [runtimeNew({ name: "jokes", install_source: "git", marketplace_plugin_id: null })],
    });
    render(<InstalledPluginsPage />);

    await screen.findByRole("heading", { name: "Jokes (submitted)" });
    expect(
      within(cardFor("Jokes (submitted)")).getByText("No settings available for this plugin."),
    ).toBeTruthy();
    expect(configCalls()).toEqual([]);
  });

  it("asks lazily, as before, when the registry predates the flag", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/v1/plugins?"))
        return Promise.resolve({ plugins: [runtimePlugin()], total: 1 });
      if (path.startsWith("/v1/marketplace/plugins?"))
        return Promise.resolve({ plugins: [catalogRow()], total: 1 });
      if (path.endsWith("/config"))
        return Promise.reject(Object.assign(new Error("Plugin 'weather' is not running"), { status: 404 }));
      return Promise.resolve({ installations: [], count: 0 });
    });
    render(<InstalledPluginsPage />);

    await screen.findByRole("heading", { name: "Weather" });
    fireEvent.click(within(cardFor("Weather")).getByText("Configure"));
    expect(await screen.findByText("No settings available for this plugin.")).toBeTruthy();
    expect(configCalls().map(([p]) => p)).toEqual(["/v1/plugins/weather/config"]);
  });

  it("keeps Configure for an install when the runtime list couldn't load", async () => {
    mockApi({ installations: [installationNew()], runtime: new Error("registry down") });
    render(<InstalledPluginsPage />);

    await screen.findByRole("heading", { name: "My Plugin" });
    expect(within(cardFor("My Plugin")).getByText("Configure", { selector: "summary" })).toBeTruthy();
  });
});

describe("ConfigurePanel", () => {
  it("loads the schema on first expand and shows 'no configurable settings' when not configurable", async () => {
    apiFetch.mockResolvedValue({ configurable: false, schema: [], values: {} });
    render(<ConfigurePanel name="my-plugin" token="tok" />);

    fireEvent.click(screen.getByText("Configure"));

    await screen.findByText("This plugin has no configurable settings.");
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/plugins/my-plugin/config",
      { token: "tok" },
    );
  });

  it("does not re-fetch when re-opened a second time", async () => {
    apiFetch.mockResolvedValue({ configurable: false, schema: [], values: {} });
    render(<ConfigurePanel name="my-plugin" token="tok" />);
    const details = screen.getByText("Configure").closest("details")!;

    fireEvent.click(screen.getByText("Configure"));
    await waitFor(() => expect(details.open).toBe(true));
    await screen.findByText("This plugin has no configurable settings.");

    fireEvent.click(screen.getByText("Configure")); // close
    await waitFor(() => expect(details.open).toBe(false));
    fireEvent.click(screen.getByText("Configure")); // re-open
    await waitFor(() => expect(details.open).toBe(true));

    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("renders form fields and submits edited values", async () => {
    apiFetch.mockResolvedValueOnce({
      configurable: true,
      schema: [{ key: "greeting", type: "string" }],
      values: { greeting: "hello" },
    });
    apiFetch.mockResolvedValueOnce({});
    render(<ConfigurePanel name="my-plugin" token="tok" />);

    fireEvent.click(screen.getByText("Configure"));
    const input = (await screen.findByLabelText("greeting")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "hi there" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Saved.");
    expect(apiFetch).toHaveBeenLastCalledWith("/v1/plugins/my-plugin/config", {
      method: "PUT",
      body: { greeting: "hi there" },
      token: "tok",
    });
  });

  it("shows the plugin surface (label/requires) and widget-aware fields", async () => {
    apiFetch.mockResolvedValueOnce({
      configurable: true,
      display: { label: "Weather", logo: "cloud-sun", category: "data-source" },
      requires: {
        services: ["influxdb"],
        optional_services: ["qdrant"],
        bundles: ["rag"],
      },
      capabilities: ["config", "data-source"],
      schema: [
        { key: "locations", type: "string", widget: "textarea", rows: 4 },
        {
          key: "mode",
          type: "string",
          widget: "select",
          options: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ],
        },
      ],
      values: { locations: "x", mode: "a" },
    });
    render(<ConfigurePanel name="weather" token="tok" />);

    fireEvent.click(screen.getByText("Configure"));

    // surface: display label + declared requirements
    expect(await screen.findByText("Weather")).toBeTruthy();
    expect(screen.getByText("Needs:")).toBeTruthy();
    expect(screen.getByText("influxdb")).toBeTruthy();
    expect(screen.getByText("qdrant (optional)")).toBeTruthy();
    expect(screen.getByText("bundle: rag")).toBeTruthy();

    // widget-aware fields: textarea + select, not a plain text input
    expect((screen.getByLabelText("locations") as HTMLElement).tagName).toBe(
      "TEXTAREA",
    );
    expect((screen.getByLabelText("mode") as HTMLElement).tagName).toBe("SELECT");
  });

  it("renders a form from json_schema/ui_schema when the flat schema is empty (#1263)", async () => {
    apiFetch.mockResolvedValueOnce({
      configurable: true,
      schema: [],
      json_schema: {
        properties: {
          api_key: { type: "string" },
          max_results: { type: "integer" },
          mode: { type: "string", enum: ["fast", "thorough"] },
        },
        required: ["api_key"],
      },
      ui_schema: { api_key: { "ui:widget": "secret" } },
      values: { max_results: 5, mode: "fast" },
    });
    render(<ConfigurePanel name="advanced-plugin" token="tok" />);

    fireEvent.click(screen.getByText("Configure"));

    expect(await screen.findByText("(required)")).toBeTruthy();
    expect((screen.getByLabelText("api_key") as HTMLInputElement).type).toBe(
      "password",
    );
    expect((screen.getByLabelText("max_results") as HTMLInputElement).type).toBe(
      "number",
    );
    expect((screen.getByLabelText("mode") as HTMLElement).tagName).toBe("SELECT");
  });

  it("prefers the flat schema over json_schema when both are present (back-compat)", async () => {
    apiFetch.mockResolvedValueOnce({
      configurable: true,
      schema: [{ key: "flat_field", type: "string" }],
      json_schema: { properties: { flat_field: { type: "string" } } },
      ui_schema: {},
      values: { flat_field: "x" },
    });
    render(<ConfigurePanel name="my-plugin" token="tok" />);

    fireEvent.click(screen.getByText("Configure"));

    expect(await screen.findByLabelText("flat_field")).toBeTruthy();
  });

  it("skips an emptied/invalid number field instead of saving null (#field-nan-guard)", async () => {
    apiFetch.mockResolvedValueOnce({
      configurable: true,
      schema: [{ key: "retries", type: "int" }],
      values: { retries: 3 },
    });
    apiFetch.mockResolvedValueOnce({});
    render(<ConfigurePanel name="my-plugin" token="tok" />);

    fireEvent.click(screen.getByText("Configure"));
    const input = (await screen.findByLabelText("retries")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Saved (left retries unchanged — not a valid number).");
    expect(apiFetch).toHaveBeenLastCalledWith("/v1/plugins/my-plugin/config", {
      method: "PUT",
      body: {},
      token: "tok",
    });
  });

  it("treats an untouched secret field as unchanged, not blanked", async () => {
    apiFetch.mockResolvedValueOnce({
      configurable: true,
      schema: [{ key: "api_key", secret: true }],
      values: { api_key: "***" },
    });
    apiFetch.mockResolvedValueOnce({});
    render(<ConfigurePanel name="my-plugin" token="tok" />);

    fireEvent.click(screen.getByText("Configure"));
    // Leave the secret field blank (its placeholder says "unchanged if left blank")
    // but still touch it, to prove the *value*, not just presence in the DOM, gates it.
    const input = await screen.findByLabelText("api_key");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Saved.");
    expect(apiFetch).toHaveBeenLastCalledWith("/v1/plugins/my-plugin/config", {
      method: "PUT",
      body: {},
      token: "tok",
    });
  });

  it("shows a neutral 'no settings' line for plugin-registry's 404 'is not running' (#2193)", async () => {
    apiFetch.mockRejectedValue(
      Object.assign(new Error("Plugin 'from-git' is not running"), { status: 404 }),
    );
    render(<ConfigurePanel name="from-git" token="tok" />);

    fireEvent.click(screen.getByText("Configure"));

    expect(await screen.findByText("No settings available for this plugin.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/is not running/)).toBeNull();
  });

  it("keeps any other 404 an error", async () => {
    apiFetch.mockRejectedValue(Object.assign(new Error("Not Found"), { status: 404 }));
    render(<ConfigurePanel name="my-plugin" token="tok" />);

    fireEvent.click(screen.getByText("Configure"));

    expect((await screen.findByRole("alert")).textContent).toBe("Not Found");
    expect(screen.queryByText("No settings available for this plugin.")).toBeNull();
  });

  it("keeps a 'not running' message with a non-404 status an error", async () => {
    apiFetch.mockRejectedValue(
      Object.assign(new Error("Plugin 'x' is not running"), { status: 503 }),
    );
    render(<ConfigurePanel name="x" token="tok" />);

    fireEvent.click(screen.getByText("Configure"));

    expect((await screen.findByRole("alert")).textContent).toBe("Plugin 'x' is not running");
  });

  it("shows a friendly error when the config fetch fails", async () => {
    apiFetch.mockRejectedValue(new Error("plugin-registry unreachable"));
    render(<ConfigurePanel name="my-plugin" token="tok" />);

    fireEvent.click(screen.getByText("Configure"));

    await screen.findByText("plugin-registry unreachable");
  });
});
