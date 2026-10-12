import { useMemo } from "react";

import { listProviders } from "./modelProviders";
import {
  getModelDefaults,
  listModels,
  type CatalogModel,
  type LocalProviderIds,
  type ModelDefaults,
} from "./modelDefaults";
import { useAsyncResource } from "./useAsyncResource";

/** What a model picker needs: the catalog, the org's role defaults (for the
 * "Org default (X)" option) and which provider rows are self-hosted. */
export interface ModelChoices {
  models: CatalogModel[];
  /** null while loading or when it couldn't be read. */
  defaults: ModelDefaults | null;
  localProviders: LocalProviderIds;
}

/** Loads ModelChoices, best-effort: a failed call just leaves that part
 * empty (no models, no known org default, every remote model Cloud).
 * Providers are only listed when `canListProviders` (org owner/admin or
 * instance admin) -- for anyone else the endpoint 403s. */
export function useModelChoices(
  token: string,
  {
    canListProviders = false,
    enabled = true,
    sessionKey,
  }: {
    canListProviders?: boolean;
    enabled?: boolean;
    /** useAuth()'s sessionKey: re-load on a new session / org, not on every
     * silent token refresh. */
    sessionKey?: string | number | null;
  } = {},
): ModelChoices {
  const modelsRes = useAsyncResource((signal) => listModels(token, signal), {
    enabled,
    deps: [sessionKey],
  });
  const defaultsRes = useAsyncResource((signal) => getModelDefaults(token, signal), {
    enabled: enabled && !!token,
    deps: [sessionKey],
  });
  const providersRes = useAsyncResource((signal) => listProviders(token, signal), {
    enabled: enabled && !!token && canListProviders,
    deps: [sessionKey],
  });
  const providers = providersRes.data;
  const localProviders = useMemo(
    () =>
      new Set(
        (Array.isArray(providers) ? providers : [])
          .filter((p) => p.is_local)
          .map((p) => p.id),
      ),
    [providers],
  );
  const defaults = defaultsRes.data;
  return {
    models: Array.isArray(modelsRes.data) ? modelsRes.data : [],
    defaults: defaults && typeof defaults === "object" ? defaults : null,
    localProviders,
  };
}
