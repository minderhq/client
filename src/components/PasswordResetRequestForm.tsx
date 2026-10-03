import { useEffect, useId, useRef, useState } from "react";

import {
  RESET_REQUEST_CONFIRMATION,
  requestPasswordReset,
} from "../lib/passwordReset";
import { inputClass, primaryButtonClass } from "../lib/ui";
import { StatusLine } from "./StatusLine";

/** Asks for a password reset link by email (`POST
 * /v1/auth/password-reset/request`).
 *
 * Enumeration-safe by construction: every accepted request ends on the same
 * fixed confirmation, whatever happened server-side (no account, SSO-linked,
 * deactivated, over a limit, or a link sent). The only other messages are for
 * outcomes that don't depend on the address: a malformed address, the per-IP
 * rate limit, email reset being off, and a network or server failure.
 *
 * Used on /forgot-password and inline on /reset-password as "Send me a new
 * link" when a link is invalid or expired. */
export function PasswordResetRequestForm({
  submitLabel = "Send reset link",
}: {
  submitLabel?: string;
}) {
  const emailId = useId();
  const errorId = useId();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  // Move focus to the confirmation once the form is replaced by it, so
  // keyboard and screen-reader users aren't left on a removed element.
  useEffect(() => {
    if (sent) confirmationRef.current?.focus();
  }, [sent]);

  // The field was disabled while sending, which drops focus. After an error,
  // put it back on the field so the user can correct it and resubmit.
  useEffect(() => {
    if (error) emailRef.current?.focus();
  }, [error]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const outcome = await requestPasswordReset(email);
      if (outcome === "accepted") {
        setSent(true);
        return;
      }
      setError(
        outcome === "invalid_email"
          ? "Enter a valid email address."
          : outcome === "rate_limited"
            ? "Too many requests from this network. Wait a minute, then try again."
            : "Password reset by email isn't available on this server. Ask an administrator to reset your password.",
      );
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div
        ref={confirmationRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className="rounded-xl border border-sky-200 bg-sky-50 p-3.5 text-sm text-sky-900 outline-none dark:border-sky-900 dark:bg-sky-950/60 dark:text-sky-100"
      >
        <p className="font-medium">Check your email</p>
        <p className="mt-1">{RESET_REQUEST_CONFIRMATION}</p>
        <p className="mt-1">
          The link works once and expires soon. If nothing arrives within a few
          minutes, check your spam folder, or ask an administrator for help.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div>
        <label
          htmlFor={emailId}
          className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Email
        </label>
        <input
          id={emailId}
          ref={emailRef}
          className={inputClass}
          type="email"
          autoComplete="email"
          maxLength={320}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
      </div>
      <button type="submit" disabled={busy} className={primaryButtonClass}>
        {busy ? "Sending…" : submitLabel}
      </button>
      <div id={errorId}>
        <StatusLine isError>{error}</StatusLine>
      </div>
    </form>
  );
}
