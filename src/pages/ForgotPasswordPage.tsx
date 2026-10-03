import { Link } from "react-router-dom";

import { InfoCallout } from "../components/InfoCallout";
import { PasswordResetRequestForm } from "../components/PasswordResetRequestForm";
import { StatusLine } from "../components/StatusLine";
import { oidcLoginUrl } from "../lib/api";
import { usePasswordResetAvailable } from "../lib/passwordReset";
import { cardClass } from "../lib/ui";

export const ASK_ADMIN_TO_RESET =
  "Password reset by email isn't available on this server. Ask your administrator to reset your password.";

export const SSO_RESET_NOTE =
  "If you sign in with SSO, your password is managed by your identity provider: reset it there. Requesting a link here sends an SSO account a reminder email instead of a reset link.";

/** `/forgot-password`: asks for a reset link by email. Reached from the login
 * page's "Forgot password?" link, which is only shown when the server offers
 * email reset; a direct visit to a server without it gets the "ask your
 * administrator" hint instead of a form that could only fail. */
export function ForgotPasswordPage() {
  const { loading, available } = usePasswordResetAvailable();

  return (
    <div className="mx-auto w-full max-w-sm">
      <h1 className="mb-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
        Reset your password
      </h1>
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
        Enter the email address of your Minder account and we'll send you a
        link to choose a new password.
      </p>

      {loading ? (
        <StatusLine>Loading…</StatusLine>
      ) : available ? (
        <>
          <div className={cardClass}>
            <PasswordResetRequestForm idPrefix="forgot" />
          </div>
          {oidcLoginUrl && (
            <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">{SSO_RESET_NOTE}</p>
          )}
        </>
      ) : (
        <InfoCallout icon="lock">{ASK_ADMIN_TO_RESET}</InfoCallout>
      )}

      <p className="mt-3 text-center text-sm text-gray-600 dark:text-gray-400">
        <Link to="/login" className="underline hover:text-indigo-600 dark:hover:text-indigo-400">
          Back to log in
        </Link>
      </p>
    </div>
  );
}
