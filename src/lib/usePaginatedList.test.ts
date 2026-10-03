import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { usePaginatedList } from "./usePaginatedList";

describe("usePaginatedList", () => {
  it("reload() loads the first page and reports hasMore from the total", async () => {
    const fetchPage = vi.fn(async (offset: number) => ({
      items: [`a${offset}`, `b${offset}`],
      total: 5,
    }));
    const { result } = renderHook(() => usePaginatedList(fetchPage, 2));

    await act(async () => {
      await result.current.reload();
    });

    expect(fetchPage).toHaveBeenCalledWith(0);
    expect(result.current.items).toEqual(["a0", "b0"]);
    expect(result.current.total).toBe(5);
    expect(result.current.status).toBe("");
    expect(result.current.hasMore).toBe(true); // 2 of 5 loaded
  });

  it("loadMore() appends the next page at offset += pageSize", async () => {
    const fetchPage = vi.fn(async (offset: number) => ({
      items: offset === 0 ? ["a", "b"] : ["c", "d"],
      total: 4,
    }));
    const { result } = renderHook(() => usePaginatedList(fetchPage, 2));

    await act(async () => {
      await result.current.reload();
    });
    await act(async () => {
      await result.current.loadMore();
    });

    expect(fetchPage).toHaveBeenLastCalledWith(2);
    expect(result.current.items).toEqual(["a", "b", "c", "d"]);
    expect(result.current.hasMore).toBe(false); // 4 of 4 loaded
  });

  it("reload() replaces rather than appends (filter-change semantics)", async () => {
    let batch = ["first"];
    const fetchPage = vi.fn(async () => ({ items: batch, total: 1 }));
    const { result } = renderHook(() => usePaginatedList(fetchPage));

    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.items).toEqual(["first"]);

    batch = ["second"];
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.items).toEqual(["second"]); // replaced, not ["first","second"]
  });

  it("surfaces a fetch failure via status and leaves items intact", async () => {
    const fetchPage = vi.fn(async () => {
      throw new Error("nope");
    });
    const { result } = renderHook(() => usePaginatedList(fetchPage));

    await act(async () => {
      await result.current.reload();
    });

    await waitFor(() => expect(result.current.status).toBe("nope"));
    expect(result.current.items).toEqual([]);
  });

  it("drops a stale response when a newer reload supersedes it (#502)", async () => {
    // Two searches race: the first (slow) resolves AFTER the second (fresh).
    // Without the run-id guard, the stale "old" page would clobber the fresh one.
    function deferred<T>() {
      let resolve!: (v: T) => void;
      const promise = new Promise<T>((r) => (resolve = r));
      return { promise, resolve };
    }
    type Pg = { items: string[]; total: number };
    const first = deferred<Pg>();
    const second = deferred<Pg>();
    const calls = [first, second];
    let call = 0;
    const fetchPage = () => calls[call++].promise;

    const { result } = renderHook(() => usePaginatedList(fetchPage));

    // Kick off two reloads back-to-back (neither resolved yet).
    act(() => {
      result.current.reload();
      result.current.reload();
    });

    // Resolve the NEWER run first, then the older/slower one.
    await act(async () => {
      second.resolve({ items: ["fresh"], total: 1 });
    });
    await waitFor(() => expect(result.current.items).toEqual(["fresh"]));

    await act(async () => {
      first.resolve({ items: ["stale"], total: 99 });
    });
    // The late "stale" page must NOT clobber the fresh results.
    expect(result.current.items).toEqual(["fresh"]);
    expect(result.current.total).toBe(1);
  });
  it("reports loading → loaded, so a page can hold its empty state until a page lands (#2195)", async () => {
    let resolve!: (v: { items: string[]; total: number }) => void;
    const fetchPage = vi.fn(
      () => new Promise<{ items: string[]; total: number }>((r) => (resolve = r)),
    );
    const { result } = renderHook(() => usePaginatedList(fetchPage));
    expect(result.current.loading).toBe(false);
    expect(result.current.loaded).toBe(false);

    act(() => {
      result.current.reload();
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.loaded).toBe(false);

    await act(async () => {
      resolve({ items: [], total: 0 });
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.loaded).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("exposes the failure as `error` and clears it on the next attempt", async () => {
    let fail = true;
    const fetchPage = vi.fn(async () => {
      if (fail) throw new Error("backend down");
      return { items: ["a"], total: 1 };
    });
    const { result } = renderHook(() => usePaginatedList(fetchPage));

    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.error).toBe("backend down");
    expect(result.current.errorOnMore).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(result.current.loaded).toBe(false);

    fail = false;
    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.items).toEqual(["a"]);
  });

  it("retry() repeats a failed Load more (appending), not a fresh first page", async () => {
    let failNext = false;
    const fetchPage = vi.fn(async (offset: number) => {
      if (failNext) {
        failNext = false;
        throw new Error("flaky");
      }
      return { items: [`item${offset}`], total: 2 };
    });
    const { result } = renderHook(() => usePaginatedList(fetchPage, 1));

    await act(async () => {
      await result.current.reload();
    });
    failNext = true;
    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.error).toBe("flaky");
    expect(result.current.errorOnMore).toBe(true);
    expect(result.current.items).toEqual(["item0"]);

    await act(async () => {
      await result.current.retry();
    });
    expect(fetchPage).toHaveBeenLastCalledWith(1);
    expect(result.current.items).toEqual(["item0", "item1"]);
  });
});
