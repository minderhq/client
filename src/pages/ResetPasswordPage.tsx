import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { PasswordResetRequestForm } from "../components/PasswordResetRequestForm";
import { StatusLine } from "../components/StatusLine";
import { useAuth } from "../lib/auth";
import { MIN_PASSWORD_LENGTH, newPasswordProblem } from "../lib/password";
import { confirmPasswordReset, type ResetConfirmOutcome } from "../lib/passwordReset";
import { clearUrlFragment, readFragmentToken, useNoReferrerMeta } from "../lib/tokenPage";
import { cardClass, fieldHintClass, inputClass, primaryButtonClass } from "../lib/ui";

/** Router state LoginPage reads to confirm a completed reset. */
export interface PasswordResetLoginState {
  passwordReset: true;
}

type LinkProblem = "missing" | "invalid";

/** `/reset-password#token=…`: the page a password reset email links to
 * (email ADR Decision 5 "Links" and "Expired or used links", Decision 6).
 *
 * - The token is read from the URL fragment once, kept in memory only, and
 *   removed from the address bar right away (`history.replaceState`). A reload
 *   therefore loses it, and the page then offers a new link.
 * - Nothing is sent on load. Link scanners that run JavaScript must not consume
 *   the token, so the confirm POST happens only when the user submits.
 * - The new password is checked against the gateway's policy before sending.
 * - Every token failure is the gateway's one generic `invalid_or_expired_token`,
 *   answered in place with a "Send me a new link" form.
 * - Success revokes every session of the account (gateway #2169) and doesn't
 *   log the user in, so this tab's session, if any, is ended and the user is
 *   sent to sign in with the new password.
 *
 * nginx serves this route with `Referrer-Policy: no-referrer` and
 * `Cache-Control: no-store`; useNoReferrerMeta is the fallback elsewhere. */
export function ResetPasswordPage() {
  const { isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  useNoReferrerMeta();

  // Read during the first render, before the layout effect below clears it.
  const [token, setToken] = useState<string | null>(() =>
    readFragmentToken(window.location.hash),
  );
  const [linkProblem, setLinkProblem] = useState<LinkProblem | null>(() =>
    token ? null : "missing",
  );
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invalidField, setInvalidField] = useState<"password" | "confirmation" | null>(
    null,
  );

  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const problemRef = useRef<HTMLDivElement>(null);

  // Clear the secret from the address bar before the first paint.
  useLayoutEffect(() => {
    clearUrlFragment();
  }, []);

  // That replaceState bypasses React Router, whose in-memory location would
  // keep `#token=…` until the next navigation, where useLocation() could read
  // it. So the router's location is replaced too, without the hash and keeping
  // the path, query and router state. That also goes through
  // history.replaceState, so no history entry with the token is created. It
  // has to be a passive effect: BrowserRouter subscribes to history in its own
  // layout effect, which runs after this page's, so a navigate() from the
  // layout effect above would never reach the router.
  useEffect(() => {
    if (location.hash) {
      navigate(
        { pathname: location.pathname, search: location.search },
        { replace: true, state: location.state },
      );
    }
    // Once, on mount: the token is read during the first render only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the link turns out to be unusable after a submit, move focus to the
  // explanation and the new-link form that replaced the password form.
  useEffect(() => {
    if (linkProblem === "invalid") problemRef.current?.focus();
  }, [linkProblem]);

  // After a failed submit, return focus to the field to fix (the inputs were
  // disabled while sending, which drops focus).
  useEffect(() => {
    if (!error) return;
    (invalidField === "confirmation" ? confirmationRef : passwordRef).current?.focus();
  }, [error, invalidField]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError("");
    setInvalidField(null);
    const problem = newPasswordProblem(password, confirmation);
    if (problem) {
      setInvalidField(problem.field);
      setError(problem.message);
      return;
    }
    setBusy(true);
    let outcome: ResetConfirmOutcome;
    try {
      outcome = await confirmPasswordReset(token, password);
    } catch {
      setBusy(false);
      setError("Couldn't reach the server. Check your connection and try again.");
      return;
    }
    if (outcome === "reset") {
      // The gateway revoked every session of the account. If this tab is
      // signed in, end its session now, rather than leaving a dead token for
      // the next refresh to discover. That also keeps LoginPage from
      // redirecting a "signed-in" tab away from the confirmation.
      //
      // This also signs out a session that belongs to a different account
      // (say, someone resetting another person's password in their own tab).
      // That is deliberate. The 204 carries no body, so there's no account to
      // compare this session with, and the token itself is opaque. Guessing
      // from claims would risk keeping a revoked session alive in the common
      // case, where it's the same account. Signing out a session that was
      // still valid costs only a sign-in. Keeping a revoked one leaves a tab
      // that looks signed in while its refresh is already rejected.
      if (isAuthenticated) logout();
      const state: PasswordResetLoginState = { passwordReset: true };
      navigate("/login", { replace: true, state });
      return;
    }
    setBusy(false);
    if (outcome === "invalid_token") {
      setToken(null);
      setPassword("");
      setConfirmation("");
      setLinkProblem("invalid");
      return;
    }
    setInvalidField(outcome === "rejected_password" ? "password" : null);
    setError(
      outcome === "rejected_password"
        ? "The server didn't accept this password. Choose a different one."
        : outcome === "rate_limited"
          ? "Too many attempts from this network. Wait a minute, then try again."
          : "Password reset by email has been turned off on this server. Ask an administrator to reset your password.",
    );
  }

  if (linkProblem) {
    return (
      <div className="mx-auto max-w-sm">
        <h1 className="mb-3 text-2xl font-bold text-gray-900 dark:text-gray-100">
          Reset your password
        </h1>
        <div
          ref={problemRef}
          tabIndex={-1}
          role={linkProblem === "invalid" ? "alert" : undefined}
          className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900 outline-none dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100"
        >
          {linkProblem === "invalid" ? (
            <>
              <p className="font-medium">This reset link is invalid or has expired.</p>
              <p className="mt-1">
                Links work once and expire after a short time, and requesting a
                new link cancels older ones. Enter your email to get a new link.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium">This page needs the link from your reset email.</p>
              <p className="mt-1">
                Open the link from the email again. If it no longer works, or you
                reloaded this page, enter your email to get a new link.
              </p>
            </>
          )}
        </div>
        <div className={cardClass}>
          <PasswordResetRequestForm submitLabel="Send me a new link" />
        </div>
        <p className="mt-3 text-center text-sm text-gray-600 dark:text-gray-400">
          <Link to="/login" className="underline hover:text-indigo-600 dark:hover:text-indigo-400">
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
        Choose a new password
      </h1>
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
        Your new password replaces the old one and signs you out everywhere.
        Then sign in with the new password.
      </p>

      <form onSubmit={handleSubmit} className={`flex flex-col gap-3 ${cardClass}`}>
        <div>
          <label
            htmlFor="reset-new-password"
            className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            New password
          </label>
          <input
            id="reset-new-password"
            ref={passwordRef}
            className={inputClass}
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            required
            aria-invalid={invalidField === "password" ? true : undefined}
            aria-describedby={
              invalidField === "password"
                ? "reset-new-password-hint reset-password-error"
                : "reset-new-password-hint"
            }
          />
          <p id="reset-new-password-hint" className={fieldHintClass}>
            At least {MIN_PASSWORD_LENGTH} characters.
          </p>
        </div>
        <div>
          <label
            htmlFor="reset-confirm-password"
            className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Confirm new password
          </label>
          <input
            id="reset-confirm-password"
            ref={confirmationRef}
            className={inputClass}
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            disabled={busy}
            required
            aria-invalid={invalidField === "confirmation" ? true : undefined}
            aria-describedby={
              invalidField === "confirmation" ? "reset-password-error" : undefined
            }
          />
        </div>

        <button type="submit" disabled={busy} className={primaryButtonClass}>
          {busy ? "Saving…" : "Set new password"}
        </button>

        <div id="reset-password-error">
          <StatusLine isError>{error}</StatusLine>
        </div>
      </form>
    </div>
  );
}
