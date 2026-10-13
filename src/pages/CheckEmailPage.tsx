import { useState } from "react";

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
          text: "Your address isn't confirmed yet. Open the link in the newest email we sent, then try again.",
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
        title="Check your email"
        subtitle="Confirm your email address to finish setting up your account."
      />
      <InfoCallout icon="mail">
        We sent a confirmation link to{" "}
        {email ? <strong>{email}</strong> : "the address you signed up with"}.
        Open it to confirm the address
        {hours ? `; it works for ${hours} hour${hours === 1 ? "" : "s"}` : ""}.
        If you can't find it, check your spam folder or ask for a new link.
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
            {checking ? "Checking…" : "I've confirmed my email"}
          </button>
          <button type="button" onClick={logout} className={secondaryButtonClass}>
            Sign out
          </button>
        </div>
        <StatusLine isError={status.isError}>{status.text}</StatusLine>
      </div>
    </>
  );
}
