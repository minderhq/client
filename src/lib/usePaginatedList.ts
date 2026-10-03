import { useCallback, useRef, useState } from "react";

import { friendlyErrorMessage } from "./api";

interface Page<T> {
  items: T[];
  total: number;
}

/** Shared "load a page, then Load More" pagination — the offset/total
 * bookkeeping (replace on filter change vs. append on Load More) was
 * hand-rolled identically in AvailablePluginsPage and AvailableToolsPage. `fetchPage`
 * receives the offset to fetch and must return that page plus the server's
 * total count; the hook owns the state transition.
 *
 * Guards against out-of-order responses (#502): each `load()` takes a
 * monotonic run id and only the newest run may commit — so a search-as-you-type
 * whose earlier request resolves LAST can't render results for the wrong query.
 *
 * Exposes the request lifecycle as well as the legacy `status` line (#2195), so
 * a page can tell "still loading" from "loaded, and empty" from "failed" and
 * never shows its empty state before the first page has actually arrived:
 * `loading` is true while a page is in flight; `loaded` is true while `items`
 * answer the current request -- set when a page commits, cleared when a
 * first-page (replace) load fails, since the items left in state then belong
 * to the previous query and must not reappear while a retry is in flight; `error` carries the latest failure (`errorOnMore` when it was a
 * Load more, so the page knows the items it shows are still current), and
 * `retry()` repeats the request that failed rather than starting over.
 */
export function usePaginatedList<T>(
  fetchPage: (offset: number) => Promise<Page<T>>,
  pageSize = 20,
) {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorOnMore, setErrorOnMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const runIdRef = useRef(0);
  const lastRequestRef = useRef<{ offset: number; replace: boolean }>({
    offset: 0,
    replace: true,
  });

  const load = useCallback(
    async (nextOffset: number, replace: boolean) => {
      const myRun = ++runIdRef.current;
      lastRequestRef.current = { offset: nextOffset, replace };
      setStatus("Loading…");
      setIsError(false);
      setError(null);
      setErrorOnMore(false);
      setLoading(true);
      try {
        const page = await fetchPage(nextOffset);
        if (runIdRef.current !== myRun) return; // superseded by a newer load
        setItems((prev) => (replace ? page.items : [...prev, ...page.items]));
        setTotal(page.total);
        setOffset(nextOffset);
        setStatus("");
        setLoaded(true);
        setLoading(false);
      } catch (e) {
        if (runIdRef.current !== myRun) return;
        const message = friendlyErrorMessage(e);
        setStatus(message);
        setIsError(true);
        setError(message);
        setErrorOnMore(!replace);
        // A failed Load more leaves the loaded items current; a failed replace
        // (new search/filter, first page) does not.
        if (replace) setLoaded(false);
        setLoading(false);
      }
    },
    [fetchPage],
  );

  const reload = useCallback(() => load(0, true), [load]);
  const loadMore = useCallback(
    () => load(offset + pageSize, false),
    [load, offset, pageSize],
  );
  const retry = useCallback(() => {
    const { offset: lastOffset, replace } = lastRequestRef.current;
    return load(lastOffset, replace);
  }, [load]);

  return {
    items,
    total,
    status,
    isError,
    error,
    errorOnMore,
    loading,
    loaded,
    reload,
    loadMore,
    retry,
    hasMore: items.length < total,
  };
}
