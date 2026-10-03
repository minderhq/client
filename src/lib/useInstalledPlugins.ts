import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { friendlyErrorMessage } from "./api";
import { type InstalledEntry, mergeInstalledPlugins } from "./installedPlugins";
import {
  type CatalogPlugin,
  fetchCatalogPlugins,
  fetchMyInstallations,
  fetchRuntimePlugins,
  type RuntimePlugin,
} from "./marketplace";
import type { Installation } from "./types";

interface LoadState {
  installations: Installation[] | null;
  runtime: RuntimePlugin[] | null;
  catalog: CatalogPlugin[] | null;
  installationsError: string | null;
  runtimeError: string | null;
  catalogError: string | null;
  /** True until every request of the current load has settled. */
  loading: boolean;
}

const EMPTY: Omit<LoadState, "loading"> = {
  installations: null,
  runtime: null,
  catalog: null,
  installationsError: null,
  runtimeError: null,
  catalogError: null,
};

function settledError(r: PromiseSettledResult<unknown>): string | null {
  return r.status === "rejected" ? friendlyErrorMessage(r.reason) : null;
}

function settledValue<T>(r: PromiseSettledResult<T>): T | null {
  return r.status === "fulfilled" ? r.value : null;
}

export interface InstalledPluginsResource extends LoadState {
  /** The merged Installed list (runtime ∪ installations, joined to the catalog). */
  entries: InstalledEntry[];
  reload: () => void;
  /** Local update after a successful uninstall (no re-fetch). The plugin stays
   * listed if plugin-registry still runs it -- that's the truth. */
  removeInstallation: (pluginId: string) => void;
  /** Local update after a successful enable/disable (no re-fetch). */
  setInstallationEnabled: (pluginId: string, enabled: boolean) => void;
}

/** Loads the three payloads the Installed view merges -- the caller's
 * marketplace installations, plugin-registry's runtime list and the catalog
 * (for source/listed version) -- in parallel, each failing independently so
 * one unreachable service doesn't blank the page. `loading` starts true when
 * enabled, so the page never flashes its empty state before the first answer.
 * Re-runs on `sessionKey` (a new login), cancels superseded runs and ignores
 * their late responses. */
export function useInstalledPlugins({
  enabled,
  tokenRef,
  sessionKey,
}: {
  enabled: boolean;
  tokenRef: MutableRefObject<string>;
  sessionKey?: unknown;
}): InstalledPluginsResource {
  const [state, setState] = useState<LoadState>(() => ({ ...EMPTY, loading: enabled }));
  const [reloadCount, setReloadCount] = useState(0);
  const runIdRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setState({ ...EMPTY, loading: false });
      return;
    }
    const myRun = ++runIdRef.current;
    const controller = new AbortController();
    const { signal } = controller;
    const token = tokenRef.current;
    setState((s) => ({ ...s, loading: true }));

    Promise.allSettled([
      fetchMyInstallations(token, signal),
      fetchRuntimePlugins(token, signal),
      fetchCatalogPlugins(token, signal),
    ]).then(([inst, rt, cat]) => {
      if (runIdRef.current !== myRun || signal.aborted) return;
      setState({
        installations: settledValue(inst),
        runtime: settledValue(rt),
        catalog: settledValue(cat),
        installationsError: settledError(inst),
        runtimeError: settledError(rt),
        catalogError: settledError(cat),
        loading: false,
      });
    });

    return () => controller.abort();
  }, [enabled, sessionKey, tokenRef, reloadCount]);

  const reload = useCallback(() => setReloadCount((n) => n + 1), []);

  const removeInstallation = useCallback((pluginId: string) => {
    setState((s) => ({
      ...s,
      installations: s.installations?.filter((i) => i.plugin_id !== pluginId) ?? null,
    }));
  }, []);

  const setInstallationEnabled = useCallback((pluginId: string, isEnabled: boolean) => {
    setState((s) => ({
      ...s,
      installations:
        s.installations?.map((i) =>
          i.plugin_id === pluginId ? { ...i, enabled: isEnabled } : i,
        ) ?? null,
    }));
  }, []);

  const entries = useMemo(
    () => mergeInstalledPlugins(state.installations, state.runtime, state.catalog),
    [state.installations, state.runtime, state.catalog],
  );

  return { ...state, entries, reload, removeInstallation, setInstallationEnabled };
}
