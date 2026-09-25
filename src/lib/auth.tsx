import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  apiBaseUrl,
  clearStoredToken,
  handleUnauthorized,
  refreshAccessToken,
  SESSION_EXPIRED_EVENT,
  storeToken,
  TOKEN_KEY,
  TOKEN_REFRESHED_EVENT,
  tokenReceivedAt,
} from "./api";
import { decodeJwtClaims, localExpiryMs, refreshDelayMs } from "./jwt";

interface AuthContextValue {
  /** The current access token. Changes on every silent refresh (#53), so
   * NEVER key a data-loading effect on it -- use `sessionKey` (#55). */
  token: string;
  /** Stable identity of the session: changes on login, logout, org switch and
   * any other explicit token adoption, but NOT on a silent refresh of the same
   * user in the same org. Key data-loading effects / useAsyncResource deps on
   * this instead of `token` (#55); empty while there is no token. */
  sessionKey: string;
  /** The caller's own user id (JWT `sub`) — used to recognise the caller's own
   * row in a server list keyed by user id (e.g. their plugin review, #1591). */
  userId: string;
  username: string;
  email: string;
  role: string;
  /** Home org id (string) and the currently-active org id — equal until the
   * user switches orgs. Empty when the token predates the tenancy spine. */
  tenantId: string;
  activeTenantId: string;
  /** Role within the ACTIVE org (owner/admin/member), distinct from `role`. */
  orgRole: string;
  isPlatformAdmin: boolean;
  isAuthenticated: boolean;
  /** Set when the login response says an admin reset this account's password
   * (minderhq/minder#1776): the app must force the change-password form
   * before anything else. */
  mustChangePassword: boolean;
  /** Clear the forced-change state after a successful password change. */
  clearMustChangePassword: () => void;
  login: (username: string, password: string) => Promise<void>;
  loginWithToken: (jwt: string) => void;
  /** Switch the active organization: re-mints the JWT server-side (new
   * active_tenant_id + org_role) and adopts it, so every subsequent request
   * reads/writes in that org's tenant context. */
  switchOrg: (organizationId: number) => Promise<void>;
  register: (
    username: string,
    email: string,
    password: string,
  ) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Upper bound on the wait before retrying a scheduled refresh that failed
 * transiently (network error / 5xx) rather than being rejected (#53). */
const REFRESH_RETRY_MS = 30_000;

/** sessionStorage key for the forced-password-change flag -- kept beside the
 * token (same lifetime) so a page reload can't skip the forced change. */
export const MUST_CHANGE_PASSWORD_KEY = "minder_must_change_password";

async function parseError(res: Response): Promise<string> {
  const data = await res.json().catch(() => ({}) as { detail?: string });
  return data.detail || `Request failed (${res.status})`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(
    () => sessionStorage.getItem(TOKEN_KEY) || "",
  );
  const [mustChangePassword, setMustChangePassword] = useState(
    () => sessionStorage.getItem(MUST_CHANGE_PASSWORD_KEY) === "1",
  );
  const claims = useMemo(() => decodeJwtClaims(token), [token]);
  // Bumped by every explicit token adoption (login, SSO/invite loginWithToken,
  // switchOrg, logout) but not by a silent refresh, so those still re-key the
  // session even when user and org are unchanged -- e.g. a re-mint after
  // joining an org must refetch the org list (#55).
  const [adoption, setAdoption] = useState(0);
  const sessionKey = token
    ? [
        adoption,
        claims.userId || claims.username,
        claims.activeTenantId || claims.tenantId,
      ].join(":")
    : "";
  // When this token was received, on the local clock (#53) -- read back from
  // sessionStorage, where every path that adopts a token records it.
  const receivedAt = useMemo(() => tokenReceivedAt(token), [token]);
  // Expiry on the LOCAL clock, measured from the token's own lifetime so a
  // skewed client clock can't expire it early or refresh it late (#53).
  const expiresAt = localExpiryMs(claims.exp, claims.iat, receivedAt);
  // An expired JWT left in sessionStorage must NOT read as logged-in — otherwise
  // the header shows a username while every write silently 401s. Treated as
  // not-authenticated so the app routes back to login (#472-adjacent UX gap).
  const authenticated = !!token && !(expiresAt > 0 && Date.now() >= expiresAt);

  const login = useCallback(async (user: string, password: string) => {
    const sentAt = Date.now();
    const res = await fetch(`${apiBaseUrl}/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user, password }),
    });
    if (!res.ok) throw new Error(await parseError(res));
    const data = (await res.json()) as {
      access_token: string;
      user?: { must_change_password?: boolean };
    };
    const mustChange = !!data.user?.must_change_password;
    setMustChangePassword(mustChange);
    if (mustChange) sessionStorage.setItem(MUST_CHANGE_PASSWORD_KEY, "1");
    else sessionStorage.removeItem(MUST_CHANGE_PASSWORD_KEY);
    setToken(data.access_token);
    setAdoption((n) => n + 1);
    storeToken(data.access_token, sentAt);
  }, []);

  const clearMustChangePassword = useCallback(() => {
    setMustChangePassword(false);
    sessionStorage.removeItem(MUST_CHANGE_PASSWORD_KEY);
  }, []);

  const register = useCallback(
    async (user: string, email: string, password: string) => {
      const res = await fetch(`${apiBaseUrl}/v1/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user, email, password }),
      });
      if (!res.ok) throw new Error(await parseError(res));
    },
    [],
  );

  const loginWithToken = useCallback((jwt: string) => {
    setToken(jwt);
    setAdoption((n) => n + 1);
    storeToken(jwt);
  }, []);

  const switchOrg = useCallback(
    async (organizationId: number) => {
      const sentAt = Date.now();
      const res = await fetch(`${apiBaseUrl}/v1/organizations/switch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ organization_id: organizationId }),
      });
      if (!res.ok) throw new Error(await parseError(res));
      const data = (await res.json()) as { access_token: string };
      setToken(data.access_token);
      setAdoption((n) => n + 1);
      storeToken(data.access_token, sentAt);
    },
    [token],
  );

  const logout = useCallback(() => {
    setToken("");
    setAdoption((n) => n + 1);
    clearStoredToken();
    setMustChangePassword(false);
    sessionStorage.removeItem(MUST_CHANGE_PASSWORD_KEY);
  }, []);

  // Global 401 reaction (#46): apiFetch/apiFetchBlob (src/lib/api.ts) already
  // clear the sessionStorage token and dispatch this event the moment any
  // request comes back unauthorized. Mirror that into React state here so
  // `isAuthenticated` flips to false immediately -- the same state `logout()`
  // produces -- instead of only the next full read of sessionStorage noticing.
  // This is what stops every already-gated page/poll (`enabled: isAuthenticated`
  // or `enabled: !!token`) from continuing to re-fire against a dead token.
  useEffect(() => {
    window.addEventListener(SESSION_EXPIRED_EVENT, logout);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, logout);
  }, [logout]);

  // Adopt a token refreshAccessToken() (src/lib/api.ts) swapped in -- whether
  // from the scheduled refresh below or from apiFetch's retry-on-401 (#53).
  useEffect(() => {
    const onRefreshed = (e: Event) => {
      const fresh = (e as CustomEvent<unknown>).detail;
      if (typeof fresh === "string" && fresh) setToken(fresh);
    };
    window.addEventListener(TOKEN_REFRESHED_EVENT, onRefreshed);
    return () => window.removeEventListener(TOKEN_REFRESHED_EVENT, onRefreshed);
  }, []);

  // Silent refresh before expiry (#53): one timer per token, at 80% of its
  // lifetime as measured on the local clock from when it was received. Any
  // token change -- refresh, login, SSO, switchOrg, logout -- tears it down
  // and (if there is still a token) schedules anew. A rejected refresh (401/403: revoked, deactivated, password reset) logs out
  // exactly like any other 401; a transient failure retries while the token is
  // still valid. An already-expired stored token schedules nothing: the API
  // can't refresh it, so it stays logged out as before.
  useEffect(() => {
    if (!token) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const run = () => {
      refreshAccessToken(token).then(
        (fresh) => {
          if (!cancelled && fresh === null) handleUnauthorized();
        },
        () => {
          if (cancelled) return;
          // Same local-clock basis as the schedule. Retry at most every
          // REFRESH_RETRY_MS, at least 1s apart, and only while the retry
          // still lands before expiry (the API can't refresh after it).
          const remaining = expiresAt - Date.now();
          const wait = Math.max(1_000, Math.min(REFRESH_RETRY_MS, remaining / 2));
          if (wait < remaining) timer = setTimeout(run, wait);
        },
      );
    };
    const delay = refreshDelayMs(expiresAt, receivedAt ?? Date.now());
    if (delay !== null) timer = setTimeout(run, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token, expiresAt, receivedAt]);

  return (
    <AuthContext.Provider
      value={{
        token,
        sessionKey,
        userId: claims.userId,
        username: claims.username,
        email: claims.email,
        role: claims.role,
        tenantId: claims.tenantId,
        activeTenantId: claims.activeTenantId,
        orgRole: claims.orgRole,
        isPlatformAdmin: claims.isPlatformAdmin,
        isAuthenticated: authenticated,
        mustChangePassword: authenticated && mustChangePassword,
        clearMustChangePassword,
        login,
        loginWithToken,
        switchOrg,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
