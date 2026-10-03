import { useEffect, useState } from "react";

import { ApiError } from "./api";
import { useAuth } from "./auth";
import { fetchSubscription } from "./billing";
import { useTokenRef } from "./useTokenRef";

/** Whether the caller may see billing in the ACTIVE org (#64).
 *
 * The gateway decides with the `org.billing.view` permission, which roles get
 * from the database (custom roles included), so the client can't derive it
 * from `orgRole`. Instead it asks once per session identity (user + active
 * org, `sessionKey`) and hides Billing only on an explicit 403. Any other
 * outcome keeps it visible and lets the page itself report the problem. The
 * server enforces either way; this only stops showing members a dead end. */
const cache = new Map<string, boolean>();
/** One shared request per session identity while it's in flight: the
 * sidebar, PageTabs and the command palette all mount this hook at once, and
 * a cold load would otherwise send the same request three times. */
const inflight = new Map<string, Promise<boolean>>();

function probe(sessionKey: string, token: string): Promise<boolean> {
  let pending = inflight.get(sessionKey);
  if (!pending) {
    // No AbortSignal: the request is shared, so one caller unmounting must
    // not cancel it for the others. Callers that went away just ignore it.
    pending = fetchSubscription(token)
      .then(
        () => {
          cache.set(sessionKey, true);
          return true;
        },
        (err: unknown) => {
          const denied = err instanceof ApiError && err.status === 403;
          if (denied) cache.set(sessionKey, false);
          return !denied;
        },
      )
      .finally(() => inflight.delete(sessionKey));
    inflight.set(sessionKey, pending);
  }
  return pending;
}

export function useBillingAccess(): boolean {
  const { sessionKey } = useAuth();
  const tokenRef = useTokenRef();
  const [visible, setVisible] = useState<boolean>(() => cache.get(sessionKey) ?? true);

  useEffect(() => {
    const token = tokenRef.current;
    if (!token || !sessionKey) return;
    const known = cache.get(sessionKey);
    if (known !== undefined) {
      setVisible(known);
      return;
    }
    let current = true;
    probe(sessionKey, token).then((v) => {
      if (current) setVisible(v);
    });
    return () => {
      current = false;
    };
  }, [sessionKey, tokenRef]);

  return visible;
}

/** Test hook: forget what was learned. */
export function resetBillingAccessCache(): void {
  cache.clear();
  inflight.clear();
}
