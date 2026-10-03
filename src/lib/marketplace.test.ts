import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchCatalogPlugins,
  fetchMyInstallations,
  fetchRuntimePlugins,
  isPluginNotRunningError,
  MAX_PAGES,
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
