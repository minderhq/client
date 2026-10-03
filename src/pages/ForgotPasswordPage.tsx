import { Link } from "react-router-dom";

import { InfoCallout } from "../components/InfoCallout";
import { PasswordResetRequestForm } from "../components/PasswordResetRequestForm";
import { useAuthCapabilities } from "../lib/passwordReset";
import { cardClass } from "../lib/ui";

/** `/forgot-password`: asks for a password reset link by email. Reached from
 * LoginPage's "Forgot password?" link, which is shown only when the gateway
 * reports `password_reset_email`.
 *
 * When the gateway reports the capability as off, the page explains that
 * instead of offering a form that can't work. While the capabilities are
 * loading, or if they can't be read, the form is shown anyway: the request
 * then reports unavailability itself (the route 404s when email reset is
 * off). */
export function ForgotPasswordPage() {
  const { capabilities } = useAuthCapabilities();
  const unavailable = capabilities !== null && capabilities.password_reset_email !== true;

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
        Reset your password
      </h1>
      {unavailable ? (
        <InfoCallout icon="info">
          Password reset by email isn't available on this server. Ask an
          administrator to reset your password.
        </InfoCallout>
      ) : (
        <>
          <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            Enter the email address of your Minder account. We'll send you a link
            to choose a new password.
          </p>
          <div className={cardClass}>
            <PasswordResetRequestForm />
          </div>
        </>
      )}
      <p className="mt-3 text-center text-sm text-gray-600 dark:text-gray-400">
        <Link to="/login" className="underline hover:text-indigo-600 dark:hover:text-indigo-400">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
