import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cachedRead,
  clearReadCache,
  invalidateReads,
  READ_CACHE_TTL_MS,
  resourcePrefix,
} from "./readCache";

afterEach(() => {
  vi.useRealTimers();
  clearReadCache();
});

describe("resourcePrefix", () => {
  it("keeps the version and the first resource segment", () => {
    expect(resourcePrefix("/v1/rag/pipeline?limit=1")).toBe("/v1/rag");
    expect(resourcePrefix("/v1/rag/knowledge-bases/7/upload")).toBe("/v1/rag");
    expect(resourcePrefix("/v1/models")).toBe("/v1/models");
    expect(resourcePrefix("/health")).toBe("/health");
  });
});

describe("cachedRead", () => {
  it("serves a hit within the TTL and reloads after it", async () => {
    vi.useFakeTimers();
    const load = vi.fn().mockResolvedValueOnce("one").mockResolvedValueOnce("two");
    expect(await cachedRead("s", "/v1/models", load)).toBe("one");
    vi.advanceTimersByTime(READ_CACHE_TTL_MS - 1);
    expect(await cachedRead("s", "/v1/models", load)).toBe("one");
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(await cachedRead("s", "/v1/models", load)).toBe("two");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("never shares an entry between sessions", async () => {
    const a = vi.fn().mockResolvedValue("alice");
    const b = vi.fn().mockResolvedValue("bob");
    expect(await cachedRead("alice-token", "/v1/teams", a)).toBe("alice");
    expect(await cachedRead("bob-token", "/v1/teams", b)).toBe("bob");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("de-duplicates concurrent reads into one request", async () => {
    let resolve!: (v: string) => void;
    const load = vi.fn(() => new Promise<string>((r) => (resolve = r)));
    const first = cachedRead("s", "/v1/bundles", load);
    const second = cachedRead("s", "/v1/bundles", load);
    resolve("shared");
    expect(await Promise.all([first, second])).toEqual(["shared", "shared"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("lets one caller abort without cancelling the shared request", async () => {
    let resolve!: (v: string) => void;
    const load = vi.fn(() => new Promise<string>((r) => (resolve = r)));
    const ctrl = new AbortController();
    const aborted = cachedRead("s", "/v1/bundles", load, { signal: ctrl.signal });
    const kept = cachedRead("s", "/v1/bundles", load);
    ctrl.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    resolve("still here");
    expect(await kept).toBe("still here");
  });

  it("does not cache a failure", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("ok");
    await expect(cachedRead("s", "/v1/status", load)).rejects.toThrow("boom");
    expect(await cachedRead("s", "/v1/status", load)).toBe("ok");
  });

  it("invalidates every entry under the written resource, and only those", async () => {
    const kbs = vi.fn().mockResolvedValue("kbs");
    const models = vi.fn().mockResolvedValue("models");
    await cachedRead("s", "/v1/rag/knowledge-bases?limit=100", kbs);
    await cachedRead("s", "/v1/models", models);
    invalidateReads("/v1/rag/pipeline");
    await cachedRead("s", "/v1/rag/knowledge-bases?limit=100", kbs);
    await cachedRead("s", "/v1/models", models);
    expect(kbs).toHaveBeenCalledTimes(2);
    expect(models).toHaveBeenCalledTimes(1);
  });

  it("does not let a read that raced an invalidation repopulate the cache", async () => {
    let resolve!: (v: string) => void;
    const stale = vi.fn(() => new Promise<string>((r) => (resolve = r)));
    const pending = cachedRead("s", "/v1/teams", stale);
    invalidateReads("/v1/teams");
    resolve("stale");
    expect(await pending).toBe("stale");
    const fresh = vi.fn().mockResolvedValue("fresh");
    expect(await cachedRead("s", "/v1/teams", fresh)).toBe("fresh");
  });

  it("clearReadCache forgets everything", async () => {
    const load = vi.fn().mockResolvedValue("x");
    await cachedRead("s", "/v1/models", load);
    clearReadCache();
    await cachedRead("s", "/v1/models", load);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
