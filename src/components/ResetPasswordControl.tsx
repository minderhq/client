import { useEffect, useId, useRef, useState } from "react";

import { apiFetch, friendlyErrorMessage } from "../lib/api";
import { MIN_PASSWORD_LENGTH } from "../lib/password";
import {
  destructiveButtonClass,
  fieldHintClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../lib/ui";
import { tabbableIn, useModal } from "../lib/useModal";
import { Dialog } from "./Dialog";
import { Icon } from "./Icon";
import { StatusLine } from "./StatusLine";

type ResetMode = "generate" | "set";

/** The common part of both reset responses (platform and org-scoped). */
interface ResetPasswordResult {
  user_id: number;
  mode: ResetMode;
  must_change_password: boolean;
  temporary_password?: string | null;
}

/** Admin reset of another user's LOCAL password: either the admin types a new
 * password or the API generates a strong temporary one, which is shown exactly
 * once here. Either way the user's sessions are signed out and they must change
 * it on next sign-in.
 *
 * `endpoint` decides the authority used: the Platform Admin route on the
 * all-users view, the org-scoped member route on an org's Users page. Callers
 * decide whether to render it at all (never on the caller's own row, never for
 * an SSO-linked account, and on the org page only when the member list says
 * the account is resettable by the caller). */
export function ResetPasswordControl({
  username,
  endpoint,
  token,
  formatError = friendlyErrorMessage,
}: {
  username: string;
  endpoint: string;
  token: string;
  /** Turns a failed reset into the message shown in the dialog. */
  formatError?: (e: unknown) => string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ResetMode>("generate");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ResetPasswordResult | null>(null);
  const [copied, setCopied] = useState(false);
  // Unique per instance: the same user can have a control on more than one
  // mounted view, and ids must never collide.
  const ids = useId();
  // Escape and a backdrop click close it like Cancel -- not mid-request.
  const modal = useModal({
    open,
    onDismiss: () => {
      if (!busy) close();
    },
  });

  // A failed request leaves focus nowhere: the button that had it was
  // disabled while the request ran. Once the form is enabled again, put focus
  // back in the dialog -- on the password being set, else the selected mode --
  // so Escape and Tab work again. If focus is still (or already again) in
  // the dialog, it stays where it is. (The error itself is announced:
  // role=alert.)
  const passwordRef = useRef<HTMLInputElement>(null);
  const refocusRef = useRef(false);
  useEffect(() => {
    if (busy || !refocusRef.current) return;
    refocusRef.current = false;
    const panel = modal.panelRef.current;
    if (!panel || panel.contains(document.activeElement)) return;
    (passwordRef.current ?? tabbableIn(panel)[0])?.focus();
  }, [busy, modal.panelRef]);

  function close() {
    // Drop the one-time password from memory as soon as the dialog closes.
    setOpen(false);
    setMode("generate");
    setPassword("");
    setError("");
    setResult(null);
    setCopied(false);
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (mode === "set" && password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<ResetPasswordResult>(endpoint, {
        method: "POST",
        token,
        body: mode === "set" ? { mode, new_password: password } : { mode },
      });
      setPassword("");
      setResult(res);
    } catch (err) {
      setError(formatError(err));
      refocusRef.current = true;
    }
    setBusy(false);
  }

  async function handleCopy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setError("Couldn't copy. Select the password and copy it manually.");
    }
  }

  const tempPassword = result?.temporary_password ?? "";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={secondaryButtonClass}
      >
        Reset password
      </button>
      {open && (
        <Dialog
          modal={modal}
          title={<>Reset password for {username}?</>}
          description={
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              {result ? (
                <>
                  {username}&apos;s password was reset and their sessions were
                  signed out. They must choose a new password the next time they
                  sign in.
                </>
              ) : (
                <>
                  This signs {username} out everywhere and makes them choose a
                  new password at their next sign-in.
                </>
              )}
            </p>
          }
        >
          {result ? (
            <div className="mt-3 flex flex-col gap-3 text-sm text-gray-600 dark:text-gray-400">
              {tempPassword && (
                <div>
                  <label
                    htmlFor={`${ids}-temp-password`}
                    className="mb-1 block font-medium text-gray-700 dark:text-gray-300"
                  >
                    Temporary password
                  </label>
                  <div className="flex gap-2">
                    <input
                      id={`${ids}-temp-password`}
                      readOnly
                      value={tempPassword}
                      onFocus={(e) => e.target.select()}
                      className={`${inputClass} font-mono`}
                    />
                    <button
                      type="button"
                      onClick={() => handleCopy(tempPassword)}
                      className={secondaryButtonClass}
                    >
                      <Icon name="copy" size={15} />{" "}
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <p className={`${fieldHintClass} font-medium`}>
                    Shown once. It can&apos;t be retrieved again after you
                    close this dialog, so share it with {username} over a
                    secure channel now.
                  </p>
                </div>
              )}
              {error && (
                <StatusLine isError className="mb-0">
                  {error}
                </StatusLine>
              )}
              <div className="flex justify-end">
                {/* Mounts while the dialog is already open, so autoFocus (not
                  data-autofocus) is what moves focus here. */}
                <button
                  type="button"
                  autoFocus
                  onClick={close}
                  className={primaryButtonClass}
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form
              onSubmit={handleReset}
              className="mt-3 flex flex-col gap-3 text-sm text-gray-600 dark:text-gray-400"
            >
              <fieldset className="flex flex-col gap-2" disabled={busy}>
                <legend className="sr-only">New password</legend>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`${ids}-mode`}
                    checked={mode === "generate"}
                    onChange={() => setMode("generate")}
                  />
                  Generate a temporary password
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`${ids}-mode`}
                    checked={mode === "set"}
                    onChange={() => setMode("set")}
                  />
                  Set a password
                </label>
                {mode === "set" && (
                  <div>
                    <label htmlFor={`${ids}-new-password`} className="sr-only">
                      New password for {username}
                    </label>
                    <input
                      ref={passwordRef}
                      id={`${ids}-new-password`}
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="New password"
                      className={inputClass}
                    />
                    <p className={fieldHintClass}>
                      At least {MIN_PASSWORD_LENGTH} characters.
                    </p>
                  </div>
                )}
              </fieldset>
              {error && (
                <StatusLine isError className="mb-0">
                  {error}
                </StatusLine>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={close}
                  disabled={busy}
                  className={secondaryButtonClass}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className={destructiveButtonClass}
                >
                  {busy ? "Resetting…" : "Reset password"}
                </button>
              </div>
            </form>
          )}
        </Dialog>
      )}
    </>
  );
}
