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
    const controller = new AbortController();
    fetchSubscription(token, controller.signal)
      .then(() => {
        cache.set(sessionKey, true);
        setVisible(true);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const denied = err instanceof ApiError && err.status === 403;
        if (denied) cache.set(sessionKey, false);
        setVisible(!denied);
      });
    return () => controller.abort();
  }, [sessionKey, tokenRef]);

  return visible;
}

/** Test hook: forget what was learned. */
export function resetBillingAccessCache(): void {
  cache.clear();
}
