import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { apiBaseUrl, SESSION_EXPIRED_EVENT, TOKEN_KEY } from "./api";
import { decodeJwtClaims, isExpired } from "./jwt";

interface AuthContextValue {
  token: string;
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

async function parseError(res: Response): Promise<string> {
  const data = await res.json().catch(() => ({}) as { detail?: string });
  return data.detail || `Request failed (${res.status})`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(
    () => sessionStorage.getItem(TOKEN_KEY) || "",
  );
  const claims = useMemo(() => decodeJwtClaims(token), [token]);
  // An expired JWT left in sessionStorage must NOT read as logged-in — otherwise
  // the header shows a username while every write silently 401s. Treated as
  // not-authenticated so the app routes back to login (#472-adjacent UX gap).
  const authenticated = !!token && !isExpired(claims.exp);

  const login = useCallback(async (user: string, password: string) => {
    const res = await fetch(`${apiBaseUrl}/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user, password }),
    });
    if (!res.ok) throw new Error(await parseError(res));
    const data = (await res.json()) as { access_token: string };
    setToken(data.access_token);
    sessionStorage.setItem(TOKEN_KEY, data.access_token);
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
    sessionStorage.setItem(TOKEN_KEY, jwt);
  }, []);

  const switchOrg = useCallback(
    async (organizationId: number) => {
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
      sessionStorage.setItem(TOKEN_KEY, data.access_token);
    },
    [token],
  );

  const logout = useCallback(() => {
    setToken("");
    sessionStorage.removeItem(TOKEN_KEY);
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

  return (
    <AuthContext.Provider
      value={{
        token,
        userId: claims.userId,
        username: claims.username,
        email: claims.email,
        role: claims.role,
        tenantId: claims.tenantId,
        activeTenantId: claims.activeTenantId,
        orgRole: claims.orgRole,
        isPlatformAdmin: claims.isPlatformAdmin,
        isAuthenticated: authenticated,
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
