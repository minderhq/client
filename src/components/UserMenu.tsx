import { Link } from "react-router-dom";

import { useAuth } from "../lib/auth";
import { primaryButtonClass, secondaryButtonClass } from "../lib/ui";
import { Icon } from "./Icon";

/** The platform's one login control. Routes to the /login page, which offers
 * local username/password auth (works over a direct localhost / LAN-IP address)
 * AND an SSO button for Traefik-fronted deployments. Previously this was a bare
 * link straight into the OIDC flow, which dead-ends over localhost since SSO
 * needs the `*.minder.local` Traefik hostnames (real DNS + TLS). */
export function UserMenu() {
  const { isAuthenticated, username, logout } = useAuth();

  if (!isAuthenticated) {
    return (
      <Link to="/login" className={primaryButtonClass}>
        <Icon name="login" size={16} />
        Log in
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Link
        to="/settings"
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100 hover:text-indigo-600 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-indigo-400"
      >
        <Icon name="user" size={18} />
        <span className="max-w-32 truncate">{username}</span>
      </Link>
      <button
        type="button"
        onClick={logout}
        className={secondaryButtonClass}
        title="Log out"
      >
        <Icon name="logout" size={16} />
        <span className="hidden sm:inline">Log out</span>
      </button>
    </div>
  );
}
