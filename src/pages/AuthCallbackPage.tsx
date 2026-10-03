import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../lib/auth";
import { completeSsoLogin } from "../lib/ssoLogin";

const SIGN_IN_INCOMPLETE = "Sign-in did not complete — please try again.";

function hashParam(hash: string, name: string): string | null {
  const match = hash.match(new RegExp(`(?:^#|&)${name}=([^&]*)`));
  return match ? match[1] : null;
}

/** Lands here once, right after api-gateway's /v1/auth/oidc/callback
 * redirects the browser back with a Minder JWT in the URL fragment (never
 * a query param -- browsers never send a fragment back to any server, so
 * the token never lands in an access log). Reads it, stores it via the
 * same auth context every other login path uses, then leaves immediately;
 * this route has no UI of its own worth lingering on.
 *
 * The token is adopted only when it completes the SSO login this browser
 * started: a pending login must exist (see lib/ssoLogin) and the nonce the
 * gateway echoes as `cnonce` must match it. The pending login is consumed
 * either way. */
export function AuthCallbackPage() {
  const { loginWithToken } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const hash = window.location.hash;
    const token = hashParam(hash, "token");
    const boundToThisLogin = completeSsoLogin(hashParam(hash, "cnonce"));
    if (token) {
      if (!boundToThisLogin) {
        navigate("/login", {
          replace: true,
          state: { oidcError: SIGN_IN_INCOMPLETE },
        });
        return;
      }
      // The token was minted during the navigation that loaded this page (the
      // API's OIDC callback redirected here), so that navigation's start is a
      // local time no later than the token's `iat` (#56). Capped at now, and
      // falling back to now, in case timeOrigin drifted from wall time.
      const now = Date.now();
      const origin = performance.timeOrigin;
      const sentAt = Number.isFinite(origin) ? Math.min(origin, now) : now;
      loginWithToken(decodeURIComponent(token), Math.floor(sentAt));
      navigate("/", { replace: true });
      return;
    }
    // A real OIDC failure (denied consent, expired auth code, misconfigured
    // client, ...) redirects back with `#error=...&error_description=...`
    // instead of a token -- this used to fall straight through to
    // navigate("/") with zero indication anything went wrong. Surface it on
    // the login page instead of silently landing logged-out.
    const error = hashParam(hash, "error_description") || hashParam(hash, "error");
    const message = error
      ? decodeURIComponent(error.replace(/\+/g, " "))
      : SIGN_IN_INCOMPLETE;
    navigate("/login", { replace: true, state: { oidcError: message } });
    // Runs once on mount -- loginWithToken/navigate are stable (useCallback/
    // react-router), and re-running this on their identity would re-read a
    // hash that's already been consumed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <p className="text-sm text-gray-500 dark:text-gray-400">
      Completing sign-in…
    </p>
  );
}
