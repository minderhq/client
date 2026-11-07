import { useState } from "react";

import { useI18n } from "../i18n";
import { InfoCallout } from "../components/InfoCallout";
import { PageHeader } from "../components/PageHeader";
import { ResendVerificationButton } from "../components/ResendVerificationButton";
import { StatusLine } from "../components/StatusLine";
import { friendlyErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  useContinueAfterVerification,
  verifyLinkHours,
} from "../lib/emailVerification";
import { useAuthCapabilities } from "../lib/passwordReset";
import { fetchMyProfile } from "../lib/profile";
import { primaryButtonClass, secondaryButtonClass } from "../lib/ui";
import { useTokenRef } from "../lib/useTokenRef";

/** "Check your email" (#2447): shown by WorkspaceGate in place of the app
 * while the signed-in account still has to confirm its email address. Its
 * token reaches nothing else, so instead of every page failing with a generic
 * error this explains what to do: open the link, ask for a new one (with the
 * server's cooldown), or say "I've confirmed it" after confirming on another
 * device. */
export function CheckEmailPage() {
  const { t, plural, rich } = useI18n();
  const { email, logout } = useAuth();
  const tokenRef = useTokenRef();
  const continueAfterVerification = useContinueAfterVerification();
  const { capabilities } = useAuthCapabilities();
  const hours = verifyLinkHours(capabilities);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<{ text: string; isError: boolean }>({
    text: "",
    isError: false,
  });

  async function proceed() {
    try {
      if (!(await continueAfterVerification())) return; // signed out
    } catch (e) {
      setStatus({ text: friendlyErrorMessage(e), isError: true });
      setChecking(false);
    }
  }

  async function checkAgain() {
    setChecking(true);
    setStatus({ text: "", isError: false });
    try {
      const profile = await fetchMyProfile(tokenRef.current);
      if (profile.email_verification_required === true) {
        setStatus({
          text: t("checkEmail.notConfirmed"),
          isError: true,
        });
        setChecking(false);
        return;
      }
    } catch (e) {
      setStatus({ text: friendlyErrorMessage(e), isError: true });
      setChecking(false);
      return;
    }
    await proceed();
  }

  return (
    <>
      <PageHeader
        icon="mail"
        title={t("checkEmail.title")}
        subtitle={t("checkEmail.subtitle")}
      />
      <InfoCallout icon="mail">
        {rich("checkEmail.callout", {
          address: email ? <strong>{email}</strong> : t("checkEmail.signedUpAddress"),
          validity: hours ? plural("checkEmail.validFor", hours) : "",
        })}
      </InfoCallout>
      <div className="mt-4 flex flex-col gap-4">
        <ResendVerificationButton onAlreadyVerified={proceed} />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={checkAgain}
            disabled={checking}
            className={primaryButtonClass}
          >
            {checking ? t("checkEmail.checking") : t("checkEmail.confirmed")}
          </button>
          <button type="button" onClick={logout} className={secondaryButtonClass}>
            {t("common.signOut")}
          </button>
        </div>
        <StatusLine isError={status.isError}>{status.text}</StatusLine>
      </div>
    </>
  );
}
