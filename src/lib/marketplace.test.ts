import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createSubmission,
  fetchCatalogPage,
  fetchCatalogPlugins,
  fetchCatalogToolsPage,
  fetchFeaturedPlugins,
  fetchLiveTools,
  fetchMyInstallations,
  fetchMyLicenses,
  fetchMySubmissions,
  fetchPluginConfig,
  fetchPluginConflicts,
  fetchPluginDependencies,
  fetchPluginRatings,
  fetchRecommendations,
  fetchReviewQueue,
  fetchRuntimePlugins,
  fetchSourceRepositoriesPage,
  fetchSourceRepository,
  fetchSourceRepositoryPluginsPage,
  hasBackendField,
  installPlugin,
  installPluginFromGit,
  isPluginNotRunningError,
  MAX_PAGES,
  runReviewerAction,
  searchCatalogPlugins,
  setPluginEnabled,
  submitForReview,
  submitPluginRating,
  uninstallPlugin,
  updatePluginConfig,
  updateSubmission,
} from "./marketplace";

const apiFetch = vi.fn();
vi.mock("./api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

afterEach(() => apiFetch.mockReset());

const named = (n: number, prefix = "p") =>
  Array.from({ length: n }, (_, i) => ({ name: `${prefix}${i}` }));

describe("fetchRuntimePlugins", () => {
  it("asks for the largest page plugin-registry allows, with the caller's token and signal", async () => {
    apiFetch.mockResolvedValue({ plugins: named(2), total: 2 });
    const signal = new AbortController().signal;
    const result = await fetchRuntimePlugins("tok", signal);

    expect(result.items).toHaveLength(2);
    expect(result.truncated).toBe(false);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith("/v1/plugins?limit=500&offset=0", { token: "tok", signal });
  });

  it("walks every page until the reported total", async () => {
    apiFetch
      .mockResolvedValueOnce({ plugins: named(500), total: 501 })
      .mockResolvedValueOnce({ plugins: named(1, "q"), total: 501 });
    const result = await fetchRuntimePlugins("tok");

    expect(result.items).toHaveLength(501);
    expect(result.truncated).toBe(false);
    expect(apiFetch.mock.calls.map((c) => c[0])).toEqual([
      "/v1/plugins?limit=500&offset=0",
      "/v1/plugins?limit=500&offset=500",
    ]);
  });

  it("stops on an empty page even without a total (no runaway loop)", async () => {
    apiFetch.mockResolvedValueOnce({ plugins: named(500) }).mockResolvedValueOnce({ plugins: [] });
    expect(await fetchRuntimePlugins("tok")).toEqual({ items: named(500), truncated: false });
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("caps the number of pages, and reports + warns that the list is incomplete", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    apiFetch.mockResolvedValue({ plugins: named(500), total: 1_000_000 });
    const result = await fetchRuntimePlugins("tok");

    expect(apiFetch).toHaveBeenCalledTimes(MAX_PAGES);
    expect(result.truncated).toBe(true);
    expect(result.items).toHaveLength(MAX_PAGES * 500);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Runtime plugin list: stopped after 20 pages/));
    warn.mockRestore();
  });

  it("is not truncated when the last allowed page completes the list", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    apiFetch.mockResolvedValue({ plugins: named(500), total: MAX_PAGES * 500 });
    const result = await fetchRuntimePlugins("tok");

    expect(result.truncated).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("treats a response without `plugins` as empty", async () => {
    apiFetch.mockResolvedValue({});
    expect(await fetchRuntimePlugins("tok")).toEqual({ items: [], truncated: false });
  });

  it("propagates errors", async () => {
    apiFetch.mockRejectedValue(new Error("down"));
    await expect(fetchRuntimePlugins("tok")).rejects.toThrow("down");
  });
});

describe("fetchCatalogPlugins", () => {
  it("pages the public catalog 100 at a time", async () => {
    apiFetch
      .mockResolvedValueOnce({ plugins: named(100), total: 150 })
      .mockResolvedValueOnce({ plugins: named(50, "q"), total: 150 });
    const result = await fetchCatalogPlugins("tok");
    expect(result.items).toHaveLength(150);
    expect(result.truncated).toBe(false);
    expect(apiFetch.mock.calls.map((c) => c[0])).toEqual([
      "/v1/marketplace/plugins?limit=100&offset=0",
      "/v1/marketplace/plugins?limit=100&offset=100",
    ]);
  });
});

describe("fetchCatalogPlugins page cap", () => {
  it("reports a catalog cut short by the page cap and warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    apiFetch.mockResolvedValue({ plugins: named(100), total: 5000 });
    const result = await fetchCatalogPlugins("tok");

    expect(result.truncated).toBe(true);
    expect(result.items).toHaveLength(MAX_PAGES * 100);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Marketplace catalog: stopped after 20 pages/));
    warn.mockRestore();
  });
});

describe("isPluginNotRunningError", () => {
  const err = (message: string, status?: number) =>
    Object.assign(new Error(message), status === undefined ? {} : { status });

  it("matches plugin-registry's 404 'is not running'", () => {
    expect(isPluginNotRunningError(err("Plugin 'from-git' is not running", 404))).toBe(true);
  });

  it("rejects other 404s, other statuses, and non-errors", () => {
    expect(isPluginNotRunningError(err("Not Found", 404))).toBe(false);
    expect(isPluginNotRunningError(err("Plugin 'x' is not running", 500))).toBe(false);
    expect(isPluginNotRunningError(err("Plugin 'x' is not running"))).toBe(false);
    expect(isPluginNotRunningError("Plugin 'x' is not running")).toBe(false);
    expect(isPluginNotRunningError(null)).toBe(false);
  });
});

describe("fetchMyInstallations", () => {
  it("returns the installations, or [] when the key is missing", async () => {
    apiFetch.mockResolvedValueOnce({ installations: [{ name: "x" }], count: 1 });
    expect(await fetchMyInstallations("tok")).toEqual([{ name: "x" }]);
    expect(apiFetch).toHaveBeenCalledWith("/v1/marketplace/installations/me", {
      token: "tok",
      signal: undefined,
    });

    apiFetch.mockResolvedValueOnce({ count: 0 });
    expect(await fetchMyInstallations("tok")).toEqual([]);
  });
});

describe("hasBackendField", () => {
  it("tells a field sent as null (a #2219 backend) from one never sent (an older one)", () => {
    expect(hasBackendField({ install_source: null }, "install_source")).toBe(true);
    expect(hasBackendField({ install_source: "git" }, "install_source")).toBe(true);
    expect(hasBackendField({ name: "x" } as { name: string; install_source?: string }, "install_source")).toBe(false);
  });

  it("ignores inherited keys and tolerates a missing object", () => {
    const inherited = Object.create({ origin: "first_party" }) as { origin?: string };
    expect(hasBackendField(inherited, "origin")).toBe(false);
    expect(hasBackendField(null as { origin?: string } | null, "origin")).toBe(false);
    expect(hasBackendField(undefined as { origin?: string } | undefined, "origin")).toBe(false);
  });
});

describe("catalog calls", () => {
  it("lists a catalog page with pricing and origin filters, without a token", async () => {
    const page = { plugins: [], count: 0, total: 0, limit: 20, offset: 40 };
    apiFetch.mockResolvedValue(page);
    expect(
      await fetchCatalogPage({ pricingModel: "paid", origin: "submitted", limit: 20, offset: 40 }),
    ).toBe(page);
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/marketplace/plugins?limit=20&offset=40&pricing_model=paid&origin=submitted",
    );
  });

  it("searches when the query is non-blank: trimmed, encoded, no pricing_model", async () => {
    apiFetch.mockResolvedValue({ plugins: [] });
    await fetchCatalogPage({ query: "  a&b ", pricingModel: "paid", limit: 20, offset: 0 });
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/marketplace/plugins/search?q=a%26b&limit=20&offset=0",
    );
    apiFetch.mockClear();
    await fetchCatalogPage({ query: "   ", limit: 20, offset: 0 });
    expect(apiFetch).toHaveBeenCalledWith("/v1/marketplace/plugins?limit=20&offset=0");
  });

  it("fetches featured plugins and the palette search", async () => {
    apiFetch.mockResolvedValue({ plugins: [] });
    await fetchFeaturedPlugins();
    expect(apiFetch).toHaveBeenLastCalledWith("/v1/marketplace/plugins/featured?limit=6");
    const signal = new AbortController().signal;
    await searchCatalogPlugins("wea ther", 5, signal);
    expect(apiFetch).toHaveBeenLastCalledWith(
      "/v1/marketplace/plugins/search?q=wea%20ther&limit=5",
      { signal },
    );
  });
});

describe("plugin graph calls", () => {
  it("reads dependencies and conflicts without a token", async () => {
    apiFetch.mockResolvedValue({});
    await fetchPluginDependencies("p1");
    await fetchPluginConflicts("p1");
    expect(apiFetch.mock.calls).toEqual([
      ["/v1/graph/dependencies/p1"],
      ["/v1/graph/conflicts/p1"],
    ]);
  });

  it("posts the installed ids for recommendations", async () => {
    apiFetch.mockResolvedValue({ recommendations: [] });
    await fetchRecommendations(["a", "b"], "tok");
    expect(apiFetch).toHaveBeenCalledWith("/v1/graph/recommendations?limit=5", {
      method: "POST",
      body: ["a", "b"],
      token: "tok",
    });
  });
});

describe("lifecycle calls", () => {
  it("installs, uninstalls, enables and disables with the right methods", async () => {
    apiFetch.mockResolvedValue({});
    await installPlugin("p1", "tok");
    await uninstallPlugin("p1", "tok");
    await setPluginEnabled("p1", true, "tok");
    await setPluginEnabled("p1", false, "tok");
    expect(apiFetch.mock.calls).toEqual([
      ["/v1/marketplace/plugins/p1/install", { method: "POST", token: "tok" }],
      ["/v1/marketplace/plugins/p1/uninstall", { method: "DELETE", token: "tok" }],
      ["/v1/marketplace/plugins/p1/enable", { method: "POST", token: "tok" }],
      ["/v1/marketplace/plugins/p1/disable", { method: "POST", token: "tok" }],
    ]);
  });

  it("propagates an API error to the caller", async () => {
    apiFetch.mockRejectedValue(new Error("boom"));
    await expect(installPlugin("p1", "tok")).rejects.toThrow("boom");
  });
});

describe("plugin-registry calls", () => {
  it("installs from git with the caller's token", async () => {
    const res = { message: "ok", plugin: "x", webhook_path: null };
    apiFetch.mockResolvedValue(res);
    const body = { repo_url: "https://example.com/r.git", ref: "main" };
    expect(await installPluginFromGit(body, "tok")).toBe(res);
    expect(apiFetch).toHaveBeenCalledWith("/v1/plugins/install-from-git", {
      method: "POST",
      body,
      token: "tok",
    });
  });

  it("reads and saves a plugin's config, encoding the name", async () => {
    apiFetch.mockResolvedValue({});
    await fetchPluginConfig("a b", "tok");
    await updatePluginConfig("a b", { k: 1 }, "tok");
    expect(apiFetch.mock.calls).toEqual([
      ["/v1/plugins/a%20b/config", { token: "tok" }],
      ["/v1/plugins/a%20b/config", { method: "PUT", body: { k: 1 }, token: "tok" }],
    ]);
  });
});

describe("Tools calls", () => {
  it("pages the catalog, inactive tools included", async () => {
    apiFetch.mockResolvedValue({ tools: [], total: 0 });
    await fetchCatalogToolsPage(40);
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/marketplace/ai/tools?active_only=false&limit=20&offset=40",
    );
  });

  it("returns the live tools, or [] when the key is missing", async () => {
    const signal = new AbortController().signal;
    apiFetch.mockResolvedValueOnce({ tools: [{ type: "function" }] });
    expect(await fetchLiveTools(signal)).toEqual([{ type: "function" }]);
    expect(apiFetch).toHaveBeenCalledWith("/v1/plugins/ai/tools", { signal });
    apiFetch.mockResolvedValueOnce({});
    expect(await fetchLiveTools()).toEqual([]);
  });
});

describe("submission and review calls", () => {
  it("lists, creates, edits and submits the caller's submissions", async () => {
    apiFetch.mockResolvedValue({});
    const signal = new AbortController().signal;
    await fetchMySubmissions("tok", signal);
    const draft = {
      name: "n",
      display_name: "N",
      author: "a",
      distribution_type: "git",
      pricing_model: "free",
      base_tier: "community",
    } as const;
    await createSubmission(draft, "tok");
    await updateSubmission("p1", { display_name: "M" }, "tok");
    await submitForReview("p1", "tok");
    expect(apiFetch.mock.calls).toEqual([
      ["/v1/marketplace/submissions/mine", { token: "tok", signal }],
      [
        "/v1/marketplace/plugins",
        { method: "POST", token: "tok", body: draft },
      ],
      ["/v1/marketplace/plugins/p1", { method: "PUT", token: "tok", body: { display_name: "M" } }],
      ["/v1/marketplace/submissions/p1/submit", { method: "POST", token: "tok" }],
    ]);
  });

  it("reads the review queue and runs reviewer actions", async () => {
    apiFetch.mockResolvedValue({ plugins: [] });
    await fetchReviewQueue("in_review", 100, "tok");
    await runReviewerAction("a/b", "reject", "tok", { notes: "no" });
    await runReviewerAction("p1", "claim", "tok");
    expect(apiFetch.mock.calls).toEqual([
      ["/v1/marketplace/submissions?status=in_review&limit=100", { token: "tok", signal: undefined }],
      ["/v1/marketplace/submissions/a%2Fb/reject", { method: "POST", token: "tok", body: { notes: "no" } }],
      ["/v1/marketplace/submissions/p1/claim", { method: "POST", token: "tok", body: undefined }],
    ]);
  });
});

describe("source repository calls", () => {
  it("pages repositories and their plugins, and reads one repository", async () => {
    apiFetch.mockResolvedValue({});
    const signal = new AbortController().signal;
    await fetchSourceRepositoriesPage(20);
    await fetchSourceRepository("r1", signal);
    await fetchSourceRepositoryPluginsPage("r1", 0);
    expect(apiFetch.mock.calls).toEqual([
      ["/v1/marketplace/repositories?limit=20&offset=20"],
      ["/v1/marketplace/repositories/r1", { signal }],
      ["/v1/marketplace/repositories/r1/plugins?limit=20&offset=0"],
    ]);
  });
});

describe("ratings and licenses calls", () => {
  it("reads ratings publicly and posts the caller's rating with a token", async () => {
    apiFetch.mockResolvedValue({});
    await fetchPluginRatings("p1");
    await submitPluginRating("p1", { rating: 4, review_text: null }, "tok");
    expect(apiFetch.mock.calls).toEqual([
      ["/v1/marketplace/plugins/p1/ratings"],
      [
        "/v1/marketplace/plugins/p1/ratings",
        { method: "POST", body: { rating: 4, review_text: null }, token: "tok" },
      ],
    ]);
  });

  it("lists the caller's licenses", async () => {
    const res = { licenses: [], count: 0 };
    apiFetch.mockResolvedValue(res);
    const signal = new AbortController().signal;
    expect(await fetchMyLicenses("tok", signal)).toBe(res);
    expect(apiFetch).toHaveBeenCalledWith("/v1/marketplace/licenses", { token: "tok", signal });
  });
});
