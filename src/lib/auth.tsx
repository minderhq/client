import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import { apiBaseUrl } from "./api";
import { decodeJwtClaims, isExpired } from "./jwt";

// Same sessionStorage key the old plugin_config.html/model_management.html
// pages used, kept for continuity across the migration (#422 -> this client).
const TOKEN_KEY = "minder_jwt";

interface AuthContextValue {
  token: string;
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

  return (
    <AuthContext.Provider
      value={{
        token,
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
