import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { InfoCallout } from "../components/InfoCallout";
import { PasswordResetRequestForm } from "../components/PasswordResetRequestForm";
import { StatusLine } from "../components/StatusLine";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  MAX_PASSWORD_BYTES,
  MIN_PASSWORD_LENGTH,
  passwordByteLength,
  passwordLength,
} from "../lib/password";
import {
  confirmPasswordReset,
  forgetResetEmail,
  isInvalidResetTokenError,
  takeResetTokenFromUrl,
} from "../lib/passwordReset";
import {
  cardClass,
  fieldHintClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../lib/ui";

export const PASSWORD_RESET_DONE =
  "Your password has been reset. Log in with your new password.";

const PASSWORD_HINT = `Use at least ${MIN_PASSWORD_LENGTH} characters. The limit is ${MAX_PASSWORD_BYTES} bytes: that's ${MAX_PASSWORD_BYTES} plain letters or digits, fewer with accents or emoji.`;

const TOO_LONG = `This password is too long. Keep it under ${MAX_PASSWORD_BYTES} bytes: accented letters, other scripts and emoji count as 2 to 4 each.`;

/** Fallback for the `Referrer-Policy: no-referrer` header the static server
 * sets on this route: a `<meta name="referrer">` for as long as the page is
 * shown, restoring whatever was there before on the way out. */
function useNoReferrer() {
  useEffect(() => {
    const existing = document.querySelector<HTMLMetaElement>('meta[name="referrer"]');
    const meta = existing ?? document.createElement("meta");
    const previous = existing?.content;
    meta.name = "referrer";
    meta.content = "no-referrer";
    if (!existing) document.head.appendChild(meta);
    return () => {
      if (existing) existing.content = previous ?? "";
      else meta.remove();
    };
  }, []);
}

function confirmErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return "Too many attempts. Wait a minute, then try again.";
    if (e.status === 422) {
      return `The server rejected this password. Use at least ${MIN_PASSWORD_LENGTH} characters and at most ${MAX_PASSWORD_BYTES} bytes.`;
    }
  }
  return "The password could not be reset right now. Try again later.";
}

const labelClass = "mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300";

/** `/reset-password#token=...`: the page a reset email links to.
 *
 * The token is read from the fragment and removed from the address bar at
 * once. It is only sent on an explicit submit (never on load, so a link
 * scanner that opens the page consumes nothing), and never logged. A reset
 * ends every session and does not sign in: on success the user goes to the
 * login page. Someone already signed in is asked to sign out first. An
 * invalid or expired link is answered in place with a form to request a new
 * one. */
export function ResetPasswordPage() {
  const { isAuthenticated, username, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  useNoReferrer();

  const [token, setToken] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [expired, setExpired] = useState(false);
  // Set by "Sign out and continue": who was signed in (to prefill the login).
  const [signedOutAs, setSignedOutAs] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; field: "password" | "confirm" | null }>({
    text: "",
    field: null,
  });

  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const expiredRef = useRef<HTMLDivElement>(null);

  // Take the token out of the address bar before the first paint.
  useLayoutEffect(() => {
    // Kept on a second run (StrictMode), when the fragment is already gone.
    const fromUrl = takeResetTokenFromUrl();
    if (fromUrl) setToken(fromUrl);
    setChecked(true);
  }, []);

  // That replaceState bypasses React Router, whose in-memory location would
  // keep `#token=...` (readable through useLocation()) until the next
  // navigation. Replace the router's location too, without the hash, keeping
  // path, query and state. This must be a passive effect: BrowserRouter
  // subscribes to history in its own layout effect, which runs after this
  // page's, so a navigate() from the layout effect above would be lost.
  useEffect(() => {
    if (location.hash) {
      navigate(
        { pathname: location.pathname, search: location.search },
        { replace: true, state: location.state },
      );
    }
    // Once, on mount: the router's location only carries the hash on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (expired) expiredRef.current?.focus();
  }, [expired]);

  // After "Sign out and continue" the form replaces the notice: continue there.
  useEffect(() => {
    if (signedOutAs !== null && !isAuthenticated) passwordRef.current?.focus();
  }, [signedOutAs, isAuthenticated]);

  const tooLong = passwordByteLength(password) > MAX_PASSWORD_BYTES;
  const signedIn = isAuthenticated && !!token && !expired;

  function fail(text: string, field: "password" | "confirm" | null) {
    setError({ text, field });
    if (field === "password") passwordRef.current?.focus();
    else if (field === "confirm") confirmRef.current?.focus();
  }

  function signOutAndContinue() {
    setSignedOutAs(username);
    logout();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || busy) return;
    setError({ text: "", field: null });
    if (passwordLength(password) < MIN_PASSWORD_LENGTH) {
      fail(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`, "password");
      return;
    }
    if (tooLong) {
      fail(TOO_LONG, "password");
      return;
    }
    if (password !== confirm) {
      fail("The two passwords don't match.", "confirm");
      return;
    }
    setBusy(true);
    try {
      await confirmPasswordReset(token, password);
    } catch (err) {
      setBusy(false);
      if (isInvalidResetTokenError(err)) {
        setToken(null);
        setExpired(true);
        setPassword("");
        setConfirm("");
      } else {
        fail(confirmErrorMessage(err), null);
      }
      return;
    }
    forgetResetEmail();
    navigate("/login", {
      replace: true,
      state: {
        notice: PASSWORD_RESET_DONE,
        ...(signedOutAs ? { username: signedOutAs } : {}),
      },
    });
  }

  const passwordError = tooLong ? TOO_LONG : error.text;
  const describedBy = (field: "password" | "confirm") =>
    [
      field === "password" ? "reset-password-hint" : "",
      passwordError && (error.field === field || (tooLong && field === "password"))
        ? "reset-password-error"
        : "",
    ]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className="mx-auto w-full max-w-sm">
      <h1 className="mb-4 text-2xl font-bold text-gray-900 dark:text-gray-100">
        Choose a new password
      </h1>

      {expired && (
        <>
          <div ref={expiredRef} tabIndex={-1} className="outline-none">
            <InfoCallout icon="warning">
              This reset link is invalid or has expired. Each link works once
              and only for a limited time, and requesting a new one cancels the
              older ones. Send yourself a new link below.
            </InfoCallout>
          </div>
          <div className={`mt-3 ${cardClass}`}>
            <PasswordResetRequestForm idPrefix="reset-new-link" submitLabel="Send me a new link" />
          </div>
        </>
      )}

      {!expired && checked && !token && (
        <InfoCallout icon="warning">
          This page needs the link from a password reset email.{" "}
          <Link to="/forgot-password" className="underline">
            Request a new link
          </Link>
        </InfoCallout>
      )}

      {signedIn && (
        <div className={cardClass}>
          <p className="mb-3 text-sm text-gray-700 dark:text-gray-300">
            You're signed in{username ? <> as <strong>{username}</strong></> : null}.
            Resetting a password signs that account out everywhere, so sign
            out first to continue.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={signOutAndContinue} className={primaryButtonClass}>
              Sign out and continue
            </button>
            <Link to="/" className={secondaryButtonClass}>
              Cancel
            </Link>
          </div>
        </div>
      )}

      {!expired && token && !isAuthenticated && (
        <form onSubmit={handleSubmit} noValidate className={`flex flex-col gap-3 ${cardClass}`}>
          <div>
            <label htmlFor="reset-new-password" className={labelClass}>
              New password
            </label>
            <input
              ref={passwordRef}
              id="reset-new-password"
              className={inputClass}
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={tooLong || error.field === "password" || undefined}
              aria-describedby={describedBy("password")}
              required
            />
            <p id="reset-password-hint" className={fieldHintClass}>
              {PASSWORD_HINT}
            </p>
          </div>
          <div>
            <label htmlFor="reset-confirm-password" className={labelClass}>
              Confirm new password
            </label>
            <input
              ref={confirmRef}
              id="reset-confirm-password"
              className={inputClass}
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={error.field === "confirm" || undefined}
              aria-describedby={describedBy("confirm")}
              required
            />
          </div>
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-pressed={showPassword}
            aria-controls="reset-new-password reset-confirm-password"
            className="self-start text-sm text-gray-600 underline hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-400"
          >
            {showPassword ? "Hide passwords" : "Show passwords"}
          </button>
          <button type="submit" disabled={busy || tooLong} className={primaryButtonClass}>
            {busy ? "Please wait…" : "Set new password"}
          </button>
          <div id="reset-password-error">
            <StatusLine isError>{passwordError}</StatusLine>
          </div>
        </form>
      )}
    </div>
  );
}
