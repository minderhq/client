import { useState } from "react";

import { friendlyErrorMessage } from "../lib/api";
import { type RegisterLanding, useAuth } from "../lib/auth";
import {
  isExistingEmail,
  registrationErrorMessage,
  registrationRefusal,
  type RegistrationRefusal,
} from "../lib/registration";
import { cardClass, fieldHintClass, inputClass, primaryButtonClass } from "../lib/ui";
import { StatusLine } from "./StatusLine";

const labelClass = "mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300";

/** Why the form stopped short of a signed-in account, so the page can offer
 * the right next step. */
export type SignUpOutcome =
  /** The API refused the account (invite unusable, or existing users only). */
  | { kind: "refused"; refusal: RegistrationRefusal; message: string }
  /** The account was created and the invite accepted, but signing in failed. */
  | { kind: "created-not-signed-in"; message: string; landing: RegisterLanding };

/** "Create account" for someone opening an invite link without an account.
 *
 * Posts `/v1/auth/register` with the invite token, which creates the account
 * AND accepts the invite in one step on the server, then signs in and calls
 * `onSignedIn`. It never redeems the invite afterwards: it is already used.
 *
 * For an email-bound invite the API refuses any other address. The invite
 * lookup returns that address masked (`j***@example.com`, #2190), so the
 * visitor types it in full, with the masked form as a hint (`maskedEmail`).
 * An older API returned it in full: then it is prefilled and read-only
 * (`lockedEmail`). */
export function InviteSignUpForm({
  inviteToken,
  lockedEmail,
  maskedEmail,
  onSignedIn,
  onStopped,
  onSignInInstead,
}: {
  inviteToken: string;
  /** The full invited address, to prefill read-only; "" for none. */
  lockedEmail: string;
  /** The masked invited address, shown as a hint; "" for none. */
  maskedEmail: string;
  /** Signed in; `landing` is the API's hint for where the account belongs. */
  onSignedIn: (landing: RegisterLanding) => void;
  onStopped: (outcome: SignUpOutcome) => void;
  onSignInInstead: () => void;
}) {
  const { register, login } = useAuth();
  const [username, setUsername] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [emailTaken, setEmailTaken] = useState(false);
  // The API refused the address for this invite: mark the field itself.
  const [emailMismatch, setEmailMismatch] = useState(false);

  const emailLocked = !!lockedEmail;
  const email = emailLocked ? lockedEmail : emailInput;
  const emailHintId = emailLocked || maskedEmail ? "invite-email-hint" : undefined;
  const emailDescribedBy =
    [emailHintId, emailMismatch ? "invite-signup-error" : undefined]
      .filter(Boolean)
      .join(" ") || undefined;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setEmailTaken(false);
    setEmailMismatch(false);
    let landing: RegisterLanding;
    try {
      landing = await register(username, email, password, inviteToken);
    } catch (err) {
      const refusal = registrationRefusal(err);
      // These leave nothing to fix in the form: hand the next step to the page.
      if (refusal === "invite_invalid" || refusal === "invite_cannot_create_account") {
        onStopped({ kind: "refused", refusal, message: registrationErrorMessage(err) });
        return;
      }
      setEmailTaken(isExistingEmail(err));
      setEmailMismatch(refusal === "invite_email_mismatch");
      setError(registrationErrorMessage(err));
      setBusy(false);
      return;
    }
    // The account exists and the invite is accepted from here on.
    try {
      await login(username, password);
    } catch (err) {
      onStopped({
        kind: "created-not-signed-in",
        landing,
        message: `Your account was created and the invite accepted, but signing in failed (${friendlyErrorMessage(err)}). Sign in to continue.`,
      });
      return;
    }
    onSignedIn(landing);
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-labelledby="invite-signup-heading"
      className={`flex flex-col gap-3 ${cardClass}`}
    >
      <h2
        id="invite-signup-heading"
        className="text-base font-semibold text-gray-900 dark:text-gray-100"
      >
        New here? Create your account
      </h2>

      <div>
        <label htmlFor="invite-username" className={labelClass}>
          Username
        </label>
        <input
          id="invite-username"
          className={inputClass}
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
      </div>

      <div>
        <label htmlFor="invite-email" className={labelClass}>
          Email
        </label>
        <input
          id="invite-email"
          className={inputClass}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmailInput(e.target.value);
            setEmailMismatch(false);
          }}
          readOnly={emailLocked}
          aria-invalid={emailMismatch || undefined}
          aria-describedby={emailDescribedBy}
          required
        />
        {emailLocked && (
          <p id="invite-email-hint" className={fieldHintClass}>
            The invite was sent to this address, so your account uses it.
          </p>
        )}
        {!emailLocked && maskedEmail && (
          <p id="invite-email-hint" className={fieldHintClass}>
            This invite is for <span className="break-all">{maskedEmail}</span>. Enter
            that address in full; your account uses it.
          </p>
        )}
      </div>

      <div>
        <label htmlFor="invite-password" className={labelClass}>
          Password
        </label>
        <input
          id="invite-password"
          className={inputClass}
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby="invite-password-hint"
          required
        />
        <p id="invite-password-hint" className={fieldHintClass}>
          At least 8 characters.
        </p>
      </div>

      <button type="submit" disabled={busy} className={`w-full ${primaryButtonClass}`}>
        {busy ? "Creating your account…" : "Create account & join"}
      </button>

      <StatusLine isError id="invite-signup-error">
        {error}
        {emailTaken && (
          <>
            {" "}
            <button
              type="button"
              onClick={onSignInInstead}
              className="underline hover:text-indigo-600 dark:hover:text-indigo-400"
            >
              Sign in to accept
            </button>
          </>
        )}
      </StatusLine>
    </form>
  );
}
