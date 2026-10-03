import { useState } from "react";

import { friendlyErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
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
  | { kind: "created-not-signed-in"; message: string };

/** "Create account" for someone opening an invite link without an account.
 *
 * Posts `/v1/auth/register` with the invite token, which creates the account
 * AND accepts the invite in one step on the server, then signs in and calls
 * `onSignedIn`. It never redeems the invite afterwards: it is already used.
 *
 * A bound invite email is prefilled and read-only (the API refuses any other
 * address for such an invite). */
export function InviteSignUpForm({
  inviteToken,
  inviteEmail,
  emailLocked,
  onSignedIn,
  onStopped,
  onSignInInstead,
}: {
  inviteToken: string;
  inviteEmail: string;
  emailLocked: boolean;
  onSignedIn: () => void;
  onStopped: (outcome: SignUpOutcome) => void;
  onSignInInstead: () => void;
}) {
  const { register, login } = useAuth();
  const [username, setUsername] = useState("");
  const [emailInput, setEmailInput] = useState(inviteEmail);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [emailTaken, setEmailTaken] = useState(false);

  const email = emailLocked ? inviteEmail : emailInput;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setEmailTaken(false);
    try {
      await register(username, email, password, inviteToken);
    } catch (err) {
      const refusal = registrationRefusal(err);
      // These leave nothing to fix in the form: hand the next step to the page.
      if (refusal === "invite_invalid" || refusal === "invite_cannot_create_account") {
        onStopped({ kind: "refused", refusal, message: registrationErrorMessage(err) });
        return;
      }
      setEmailTaken(isExistingEmail(err));
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
        message: `Your account was created and the invite accepted, but signing in failed (${friendlyErrorMessage(err)}). Sign in to continue.`,
      });
      return;
    }
    onSignedIn();
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
          onChange={(e) => setEmailInput(e.target.value)}
          readOnly={emailLocked}
          aria-describedby={emailLocked ? "invite-email-hint" : undefined}
          required
        />
        {emailLocked && (
          <p id="invite-email-hint" className={fieldHintClass}>
            The invite was sent to this address, so your account uses it.
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

      <StatusLine isError>
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
