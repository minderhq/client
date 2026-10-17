import { Link } from "react-router-dom";

import { InfoCallout } from "../components/InfoCallout";
import { PasswordResetRequestForm } from "../components/PasswordResetRequestForm";
import { StatusLine } from "../components/StatusLine";
import { useI18n } from "../i18n";
import { oidcLoginUrl } from "../lib/api";
import { usePasswordResetAvailable } from "../lib/passwordReset";
import { cardClass } from "../lib/ui";

/** `/forgot-password`: asks for a reset link by email. Reached from the login
 * page's "Forgot password?" link, which is only shown when the server offers
 * email reset; a direct visit to a server without it gets the "ask your
 * administrator" hint instead of a form that could only fail. */
export function ForgotPasswordPage() {
  const { loading, available } = usePasswordResetAvailable();
  const { t } = useI18n();

  return (
    <div className="mx-auto w-full max-w-sm">
      <h1 className="mb-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
        {t("auth.forgot.title")}
      </h1>
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
        {t("auth.forgot.intro")}
      </p>

      {loading ? (
        <StatusLine>{t("common.loading")}</StatusLine>
      ) : available ? (
        <>
          <div className={cardClass}>
            <PasswordResetRequestForm idPrefix="forgot" />
          </div>
          {oidcLoginUrl && (
            <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">{t("auth.forgot.ssoNote")}</p>
          )}
        </>
      ) : (
        <InfoCallout icon="lock">{t("auth.forgot.askAdmin")}</InfoCallout>
      )}

      <p className="mt-3 text-center text-sm text-gray-600 dark:text-gray-400">
        <Link to="/login" className="underline hover:text-indigo-600 dark:hover:text-indigo-400">
          {t("auth.forgot.backToLogin")}
        </Link>
      </p>
    </div>
  );
}
