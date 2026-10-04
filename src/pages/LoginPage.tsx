import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

import { StatusLine } from "../components/StatusLine";
import { friendlyErrorMessage, oidcLoginUrl } from "../lib/api";
import { useAuth } from "../lib/auth";
import { passwordResetOffered, useAuthCapabilities } from "../lib/passwordReset";
import { redirectTo } from "../lib/redirect";
import {
  registrationErrorMessage,
  registrationModeFrom,
  registrationRefusal,
} from "../lib/registration";
import { forgetReturnPath, rememberReturnPath, safeReturnPath } from "../lib/returnPath";
import { beginSsoLogin } from "../lib/ssoLogin";
import {
  cardClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../lib/ui";

/** Local username/password login — the path that actually works when the client
 * is reached directly (e.g. http://localhost:8009 or a LAN IP), where the SSO
 * button can't: OIDC redirects the browser to the Traefik-only `*.minder.local`
 * hostnames, which need real DNS + TLS the direct-port access path doesn't have.
 * The api-gateway's local JWT auth (`/v1/auth/login` + `/v1/auth/register`) is
 * reachable on the same `apiBaseUrl` the rest of the client already uses, so this
 * form works over plain localhost. The SSO button below is shown only when
 * VITE_OIDC_LOGIN_URL is configured (a Traefik + real-domain deployment) — no
 * dead-end button over localhost.
 *
 * The "Create one" form follows the instance's registration mode: shown in
 * `open` mode (or when the API doesn't report a mode), replaced by an
 * "accounts are by invitation" note in `invite` mode, and by an SSO/admin
 * pointer in `sso_only` mode (reported as `closed`). A page that sends the user here can pass
 * `state.from` (an in-app path) to come back to after signing in. */
export function LoginPage() {
  const { isAuthenticated, login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const routeState = location.state as
    | { oidcError?: string; notice?: string; username?: string; from?: string }
    | null;
  // Where to go after signing in, when another page (e.g. an invite link)
  // sent the user here. Read once: the state is cleared below.
  const [returnPath] = useState(() => safeReturnPath(routeState?.from));
  // One capabilities request feeds both the forgot-password link and the
  // registration mode.
  const capabilities = useAuthCapabilities();
  const registrationMode = registrationModeFrom(capabilities.capabilities);
  // Set when the API refuses a sign-up with `invite_required` although the
  // mode looked open (stale or unknown mode): stop offering the form.
  const [inviteOnly, setInviteOnly] = useState(false);
  const signUpMode = inviteOnly ? "invite" : registrationMode;

  const [mode, setMode] = useState<"login" | "register">("login");
  // Prefilled when a password reset knew who was resetting.
  const [username, setUsername] = useState(routeState?.username ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // A failed OIDC/SSO redirect (denied consent, expired code, ...) lands here
  // via AuthCallbackPage's navigate("/login", {state: {oidcError}}) -- surface
  // it instead of silently landing on a blank login form.
  const [error, setError] = useState(routeState?.oidcError ?? "");
  // A completed password reset lands here with a success notice (it never
  // signs the user in).
  const [notice, setNotice] = useState(routeState?.notice ?? "");
  // "Forgot password?" is offered only when the server can send reset emails.
  const capabilitiesLoading = capabilities.loading;
  const passwordResetAvailable = passwordResetOffered(capabilities.capabilities);

  // Back from a password reset: put the cursor where the user continues.
  const [focusAfterReset] = useState(() =>
    routeState?.notice ? (routeState.username ? "password" : "username") : null,
  );

  // The reset notice, prefill and SSO error are read into state above. Drop
  // them from the history entry (React Router keeps navigation state in
  // history.state), so a reload or Back/Forward doesn't show them again.
  // The return path stays, so a reload still comes back to the invite.
  useEffect(() => {
    // A path left by an SSO attempt abandoned at the identity provider (it may
    // be an invite token): drop it. The SSO button stores a fresh one.
    forgetReturnPath();
    if (routeState?.notice || routeState?.oidcError) {
      navigate(
        { pathname: location.pathname, search: location.search },
        { replace: true, state: returnPath ? { from: returnPath } : null },
      );
    }
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isAuthenticated) return <Navigate to={returnPath ?? "/"} replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    if (mode === "register") {
      try {
        await register(username, email, password);
      } catch (err) {
        if (registrationRefusal(err) === "invite_required") {
          setInviteOnly(true);
          setMode("login");
        }
        setError(registrationErrorMessage(err));
        setBusy(false);
        return;
      }
    }
    try {
      // register() only creates the account (no token), so log in either way.
      await login(username, password);
      navigate(returnPath ?? "/", { replace: true });
    } catch (err) {
      setError(friendlyErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
        {mode === "login" ? "Log in" : "Create an account"}
      </h1>
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
        {mode === "login"
          ? "Sign in with your Minder account to make changes. Browsing stays open without logging in."
          : "Create a local Minder account, then you'll be signed in."}
      </p>

      <form onSubmit={handleSubmit} className={`flex flex-col gap-3 ${cardClass}`}>
        <div>
          <label
            htmlFor="login-username"
            className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Username
          </label>
          <input
            id="login-username"
            className={inputClass}
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus={focusAfterReset === "username"}
            required
          />
        </div>

        {mode === "register" && (
          <div>
            <label
              htmlFor="login-email"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Email
            </label>
            <input
              id="login-email"
              className={inputClass}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
        )}

        <div>
          <label
            htmlFor="login-password"
            className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Password
          </label>
          <input
            id="login-password"
            className={inputClass}
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus={focusAfterReset === "password"}
            required
          />
          {mode === "login" && passwordResetAvailable && (
            <p className="mt-1 text-right text-sm">
              <Link
                to="/forgot-password"
                className="text-gray-600 underline hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-400"
              >
                Forgot password?
              </Link>
            </p>
          )}
          {/* No email reset on this server (e.g. no mail configured): no
              dead-end link, just who can help. */}
          {mode === "login" && !capabilitiesLoading && !passwordResetAvailable && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Forgot your password? Ask your administrator to reset it.
            </p>
          )}
        </div>

        <button type="submit" disabled={busy} className={primaryButtonClass}>
          {busy
            ? "Please wait…"
            : mode === "login"
              ? "Log in"
              : "Create account & log in"}
        </button>

        <StatusLine>{notice}</StatusLine>
        <StatusLine isError>{error}</StatusLine>
      </form>

      {mode === "login" && signUpMode === "invite" && (
        <p className="mt-3 text-center text-sm text-gray-600 dark:text-gray-400">
          No account yet? Accounts on this instance are created by invitation.
          If you were invited, open the link in your invitation. Otherwise, ask
          an administrator of your organization to invite you.
        </p>
      )}

      {mode === "login" && signUpMode === "sso_only" && (
        <p className="mt-3 text-center text-sm text-gray-600 dark:text-gray-400">
          No account yet? Sign-up is turned off on this instance.{" "}
          {oidcLoginUrl
            ? "Sign in with SSO below; your account is set up the first time you do."
            : "Ask an administrator to create an account for you."}
        </p>
      )}

      {/* While the mode is still loading, offer nothing rather than a form
          that may turn out not to work. */}
      {(mode === "register" ||
        (!capabilitiesLoading &&
          signUpMode !== "invite" &&
          signUpMode !== "sso_only")) && (
        <p className="mt-3 text-center text-sm text-gray-600 dark:text-gray-400">
          {mode === "login" ? (
            <>
              No account yet?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("register");
                  setError("");
                }}
                className="underline hover:text-indigo-600 dark:hover:text-indigo-400"
              >
                Create one
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setError("");
                }}
                className="underline hover:text-indigo-600 dark:hover:text-indigo-400"
              >
                Log in
              </button>
            </>
          )}
        </p>
      )}

      {/* Only offer SSO when it's actually configured (VITE_OIDC_LOGIN_URL set
          to a real Traefik hostname). Otherwise the button dead-ends: the old
          baked-in api.minder.local can't resolve over a plain localhost/LAN
          address, so a real domain + TLS is required for the OIDC flow to
          complete. Unconfigured → local login above is the working path. */}
      {oidcLoginUrl && (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-gray-400">
            <span className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
            or
            <span className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
          </div>

          <a
            href={oidcLoginUrl}
            onClick={(e) => {
              // Record this browser's pending login before leaving, so the
              // callback only accepts the sign-in it started.
              e.preventDefault();
              rememberReturnPath(returnPath);
              redirectTo(beginSsoLogin(oidcLoginUrl));
            }}
            className={`block text-center ${secondaryButtonClass}`}
          >
            Sign in with SSO (Authelia)
          </a>
          <p className="mt-2 text-center text-xs text-gray-500 dark:text-gray-400">
            SSO requires reaching Minder through its Traefik hostname with a real
            domain + TLS.
          </p>
          <p className="mt-1 text-center text-xs text-gray-500 dark:text-gray-400">
            SSO accounts reset their password at their identity provider.
          </p>
        </>
      )}
    </div>
  );
}
