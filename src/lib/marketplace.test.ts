import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchCatalogPlugins, fetchMyInstallations, fetchRuntimePlugins } from "./marketplace";

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

    expect(result).toHaveLength(2);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith("/v1/plugins?limit=500&offset=0", { token: "tok", signal });
  });

  it("walks every page until the reported total", async () => {
    apiFetch
      .mockResolvedValueOnce({ plugins: named(500), total: 501 })
      .mockResolvedValueOnce({ plugins: named(1, "q"), total: 501 });
    const result = await fetchRuntimePlugins("tok");

    expect(result).toHaveLength(501);
    expect(apiFetch.mock.calls.map((c) => c[0])).toEqual([
      "/v1/plugins?limit=500&offset=0",
      "/v1/plugins?limit=500&offset=500",
    ]);
  });

  it("stops on an empty page even without a total (no runaway loop)", async () => {
    apiFetch.mockResolvedValueOnce({ plugins: named(500) }).mockResolvedValueOnce({ plugins: [] });
    expect(await fetchRuntimePlugins("tok")).toHaveLength(500);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("caps the number of pages", async () => {
    apiFetch.mockResolvedValue({ plugins: named(500), total: 1_000_000 });
    await fetchRuntimePlugins("tok");
    expect(apiFetch).toHaveBeenCalledTimes(20);
  });

  it("treats a response without `plugins` as empty", async () => {
    apiFetch.mockResolvedValue({});
    expect(await fetchRuntimePlugins("tok")).toEqual([]);
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
    expect(await fetchCatalogPlugins("tok")).toHaveLength(150);
    expect(apiFetch.mock.calls.map((c) => c[0])).toEqual([
      "/v1/marketplace/plugins?limit=100&offset=0",
      "/v1/marketplace/plugins?limit=100&offset=100",
    ]);
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
