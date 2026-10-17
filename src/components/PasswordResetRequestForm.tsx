import { useEffect, useRef, useState } from "react";

import { i18n, useI18n } from "../i18n";
import { ApiError } from "../lib/api";
import {
  rememberedResetEmail,
  rememberResetEmail,
  requestPasswordReset,
} from "../lib/passwordReset";
import { inputClass, primaryButtonClass } from "../lib/ui";
import { StatusLine } from "./StatusLine";

function requestErrorMessage(e: unknown): string {
  const { t } = i18n();
  if (e instanceof ApiError) {
    if (e.status === 429) return t("auth.resetRequest.rateLimited");
    if (e.status === 422) return t("auth.resetRequest.invalidEmail");
  }
  return t("auth.resetRequest.failed");
}

/** Email field that asks for a password reset link. Used by the forgot-password
 * page and, after an expired link, inline on the reset page. It is prefilled
 * with the address last used in this tab. Once a request is accepted the form
 * is replaced by the neutral confirmation, which takes focus, so it isn't
 * resubmitted by accident. */
export function PasswordResetRequestForm({
  idPrefix,
  submitLabel,
}: {
  idPrefix: string;
  submitLabel?: string;
}) {
  const { t } = useI18n();
  const [email, setEmail] = useState(rememberedResetEmail);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const sentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (sent) sentRef.current?.focus();
  }, [sent]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const address = email.trim();
    setBusy(true);
    setError("");
    try {
      await requestPasswordReset(address);
      rememberResetEmail(address);
      setSent(true);
    } catch (err) {
      setError(requestErrorMessage(err));
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div ref={sentRef} tabIndex={-1} className="outline-none">
        {/* Shown after every accepted request, whatever happened server-side:
          it never says whether the address has an account. The server lets
          operators set the link lifetime between 15 and 60 minutes, so
          "within an hour" holds for any setting; the email itself states the
          exact time. */}
        <StatusLine>{t("auth.resetRequest.sent")}</StatusLine>
      </div>
    );
  }

  const inputId = `${idPrefix}-email`;
  const errorId = `${idPrefix}-error`;
  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div>
        <label
          htmlFor={inputId}
          className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          {t("common.email")}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          className={inputClass}
          type="email"
          autoComplete="email"
          maxLength={320}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          required
        />
      </div>
      <button type="submit" disabled={busy} className={primaryButtonClass}>
        {busy ? t("common.sending") : (submitLabel ?? t("auth.resetRequest.submit"))}
      </button>
      <div id={errorId}>
        <StatusLine isError>{error}</StatusLine>
      </div>
    </form>
  );
}
