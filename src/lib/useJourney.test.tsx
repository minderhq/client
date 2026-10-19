import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "./api";

vi.mock("./auth", () => ({
  useAuth: () => ({ token: "tok", sessionKey: "1:u:org" }),
}));

// Imported after the mock is registered.
import { useJourney } from "./useJourney";

function respond(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, headers: new Headers() } as Response;
}

describe("useJourney (#141)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        respond(
          String(url).includes("knowledge-bases")
            ? { items: [{ document_count: 1, vector_count: 4 }], total: 1, limit: 100, offset: 0 }
            : { items: [], total: 2, limit: 100, offset: 0 },
        ),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shares the page's cached reads instead of fetching its own", async () => {
    // The page loaded its lists first...
    await apiFetch("/v1/rag/knowledge-bases?limit=100", { token: "tok", cache: true });
    await apiFetch("/v1/rag/pipeline?limit=100", { token: "tok", cache: true });
    expect(fetch).toHaveBeenCalledTimes(2);

    // ...so the stepper's counts come from the cache.
    const { result } = renderHook(() => useJourney());
    await waitFor(() =>
      expect(result.current.data).toEqual({ kbCount: 1, readyKbCount: 1, pipelineCount: 2 }),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not refetch when a stable refreshKey is re-rendered", async () => {
    const { result, rerender } = renderHook(({ k }) => useJourney(k), {
      initialProps: { k: "1:1" },
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(fetch).toHaveBeenCalledTimes(2);

    // The page re-renders (e.g. a new list array with the same counts).
    rerender({ k: "1:1" });
    rerender({ k: "1:1" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("re-reads after a write changes the key", async () => {
    const { result, rerender } = renderHook(({ k }) => useJourney(k), {
      initialProps: { k: "1:1" },
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());

    // A changed key without a write is served from the cache.
    rerender({ k: "2:1" });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(2);

    // A write invalidates the cached lists, so the next key change refetches.
    await apiFetch("/v1/rag/knowledge-bases", { method: "POST", body: {}, token: "tok" });
    rerender({ k: "3:1" });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(5));
  });
});
