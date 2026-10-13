import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { InfoCallout } from "../components/InfoCallout";
import { ResendVerificationButton } from "../components/ResendVerificationButton";
import { StatusLine } from "../components/StatusLine";
import { friendlyErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  confirmEmailVerification,
  formatWait,
  takeVerifyTokenFromUrl,
  useContinueAfterVerification,
  type VerifyResult,
} from "../lib/emailVerification";
import { cardClass, primaryButtonClass, secondaryButtonClass } from "../lib/ui";
import { useNoReferrer } from "../lib/useNoReferrer";

export const EMAIL_VERIFIED_NOTICE = "Your email address is confirmed. Log in to continue.";

/** `/verify-email#token=mev_...`: the page a verification email links to
 * (#2447).
 *
 * The token is read from the fragment and removed from the address bar
 * before the first paint, and never logged. It is only sent when the user
 * presses "Confirm my email" (never on load, so a mail scanner that opens
 * the link confirms nothing). The link works on any device, signed in or
 * not: a signed-in session is then swapped for a full one; a signed-out
 * visitor is sent to log in. An expired or used link offers a new one (to a
 * signed-in user; a signed-out one logs in first, which leads to "Check your
 * email"). */
export function VerifyEmailPage() {
  const { isAuthenticated } = useAuth();
  const continueAfterVerification = useContinueAfterVerification();
  const navigate = useNavigate();
  const location = useLocation();
  useNoReferrer();

  const [token, setToken] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  // Set once a signed-in session has been moved to its full token.
  const [continued, setContinued] = useState(false);
  const [continueError, setContinueError] = useState("");
  const outcomeRef = useRef<HTMLDivElement>(null);

  // Take the token out of the address bar before the first paint.
  useLayoutEffect(() => {
    // Kept on a second run (StrictMode), when the fragment is already gone.
    const fromUrl = takeVerifyTokenFromUrl();
    if (fromUrl) setToken(fromUrl);
    setChecked(true);
  }, []);

  // Drop the hash from the router's own location too (see ResetPasswordPage:
  // must be a passive effect, after BrowserRouter subscribes to history).
  useEffect(() => {
    if (location.hash) {
      navigate(
        { pathname: location.pathname, search: location.search },
        { replace: true, state: location.state },
      );
    }
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (result && result.kind !== "error") outcomeRef.current?.focus();
  }, [result]);

  async function moveSessionOn() {
    setContinueError("");
    try {
      if (await continueAfterVerification()) setContinued(true);
    } catch (e) {
      setContinueError(friendlyErrorMessage(e));
    }
  }

  async function confirm() {
    if (!token || busy) return;
    setBusy(true);
    const outcome = await confirmEmailVerification(token);
    // A link works once: whatever the server said, only a transient failure
    // or a rate limit leaves it worth pressing again.
    if (outcome.kind !== "error" && outcome.kind !== "rate_limited") setToken(null);
    setResult(outcome);
    if (outcome.kind === "verified" && isAuthenticated) await moveSessionOn();
    setBusy(false);
  }

  const signedOut = !isAuthenticated;
  const loginLink = (
    <Link to="/login" className="underline">
      Log in
    </Link>
  );

  let outcome: ReactNode = null;
  if (result?.kind === "verified") {
    outcome = (
      <>
        <InfoCallout icon="check">Your email address is confirmed.</InfoCallout>
        {signedOut ? (
          <Link
            to="/login"
            state={{ notice: EMAIL_VERIFIED_NOTICE }}
            className={`mt-3 inline-block ${primaryButtonClass}`}
          >
            Log in to continue
          </Link>
        ) : continued ? (
          <Link to="/" className={`mt-3 inline-block ${primaryButtonClass}`}>
            Continue to Minder
          </Link>
        ) : continueError ? (
          <div className="mt-3 flex flex-col gap-2">
            <StatusLine isError>{continueError}</StatusLine>
            <button
              type="button"
              onClick={moveSessionOn}
              className={`self-start ${secondaryButtonClass}`}
            >
              Try again
            </button>
          </div>
        ) : (
          <StatusLine>Finishing sign-in…</StatusLine>
        )}
      </>
    );
  } else if (result?.kind === "expired" || result?.kind === "invalid") {
    outcome = (
      <>
        <InfoCallout icon="warning">
          {result.kind === "expired"
            ? "This link has expired. Links work for a limited time; ask for a new one."
            : "This link can't be used. It may have been used already, or a newer link replaced it. If you've already confirmed your address, just log in."}
        </InfoCallout>
        <div className="mt-3">
          {signedOut ? (
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {loginLink} to continue, or to get a new link if your address
              isn't confirmed yet.
            </p>
          ) : (
            <ResendVerificationButton onAlreadyVerified={() => navigate("/", { replace: true })} />
          )}
        </div>
      </>
    );
  } else if (result?.kind === "unavailable") {
    outcome = (
      <InfoCallout icon="warning">
        This server doesn't verify email addresses, so there is nothing to
        confirm. {signedOut ? <>{loginLink} to continue.</> : null}
      </InfoCallout>
    );
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <h1 className="mb-4 text-2xl font-bold text-gray-900 dark:text-gray-100">
        Confirm your email
      </h1>

      <div ref={outcomeRef} tabIndex={-1} className="outline-none">
        {outcome}
      </div>

      {checked && !token && !result && (
        <InfoCallout icon="warning">
          This page needs the link from your verification email. Open the
          newest one we sent you.{" "}
          {signedOut ? (
            <>{loginLink} to ask for a new link.</>
          ) : (
            <Link to="/" className="underline">
              Ask for a new link
            </Link>
          )}
        </InfoCallout>
      )}

      {token && (
        <div className={`flex flex-col gap-3 ${cardClass}`}>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Press the button to confirm the email address this link was sent to.
          </p>
          <button
            type="button"
            onClick={confirm}
            disabled={busy}
            className={primaryButtonClass}
          >
            {busy ? "Confirming…" : "Confirm my email"}
          </button>
          {result?.kind === "rate_limited" && (
            <StatusLine isError>
              Too many attempts. Wait {formatWait(result.retryAfterSeconds)}, then try again.
            </StatusLine>
          )}
          {result?.kind === "error" && <StatusLine isError>{result.message}</StatusLine>}
        </div>
      )}
    </div>
  );
}
