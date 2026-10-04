import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { InfoCallout } from "../components/InfoCallout";
import { InviteSignUpForm, type SignUpOutcome } from "../components/InviteSignUpForm";
import { PageHeader } from "../components/PageHeader";
import { StatusLine } from "../components/StatusLine";
import { ApiError, apiFetch, friendlyErrorMessage, oidcLoginUrl } from "../lib/api";
import { type RegisterLanding, useAuth } from "../lib/auth";
import { useRegistrationMode } from "../lib/registration";
import { primaryButtonClass, secondaryButtonClass } from "../lib/ui";
import { useAsyncResource } from "../lib/useAsyncResource";
import { useNoReferrer } from "../lib/useNoReferrer";

export interface InviteInfo {
  id: number;
  email: string;
  // Team invite (null for an org invite) …
  team_id?: number | null;
  team_name?: string | null;
  team_role?: string | null;
  // … or org invite (#1209).
  organization_id?: number | null;
  org_name?: string | null;
  org_role?: string | null;
  status: "pending" | "accepted" | "revoked" | "expired";
  // Optional, used when the API provides them (#2190): who sent the invite;
  // whether it only works for `email` (false = a shareable link, and `email`
  // is ""); and whether it may create a new account or only be accepted by an
  // existing one. When `email_bound` is present, `email` is masked
  // (`j***@example.com`) and is only ever a hint. An older API sends none of
  // them and the address in full: it is treated as bound (a default
  // single-use invite) and as able to create an account (the API still
  // refuses with a code the page explains).
  invited_by_name?: string | null;
  email_bound?: boolean | null;
  can_create_account?: boolean | null;
}


const INVALID_LINK =
  "This invite link isn't valid. Check that you copied the whole link, or ask the person who invited you for a new one.";

async function fetchInvite(inviteToken: string, signal: AbortSignal): Promise<InviteInfo> {
  try {
    return await apiFetch<InviteInfo>(`/v1/invites/by-token/${inviteToken}`, { signal });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) throw new Error(INVALID_LINK);
    throw e;
  }
}

/** Where a new member lands: org invites on the Organization page, team
 * invites on Teams. */
function landingPath(info: InviteInfo | null): string {
  return info?.organization_id ? "/organization" : "/platform/teams";
}

/** Where a just-registered account lands: the register response's hint when
 * the API gives one (the team for a team invite, else the org), otherwise the
 * invite's own target. */
function signUpLandingPath(landing: RegisterLanding | undefined, info: InviteInfo | null): string {
  if (landing?.team_id != null) return "/platform/teams";
  if (landing?.organization_id != null) return "/organization";
  return landingPath(info);
}

/** The 409 `detail` the API returns when a redeem finds the invite no longer
 * pending: withdrawn (revoked), or already used up. The lookup's `status`
 * then tells which. */
const NO_LONGER_AVAILABLE = "Invite is no longer available";

/** Message for a failed redeem by a signed-in user. */
function redeemErrorMessage(e: unknown, info: InviteInfo | null, myEmail: string): string {
  if (e instanceof ApiError) {
    if (e.status === 403) {
      const who = myEmail ? `, but you're signed in as ${myEmail}` : "";
      return `This invite was sent to ${info?.email || "a different address"}${who}. Sign out and sign in with the invited account, or ask for an invite to your own address.`;
    }
    if (e.status === 409) {
      return e.message === NO_LONGER_AVAILABLE
        ? "This invite is no longer available: it was withdrawn, or it has already been used. Ask the person who invited you for a new link."
        : "This invite has already been used.";
    }
    if (e.status === 410) {
      return "This invite has expired. Ask the person who invited you for a new link.";
    }
    if (e.status === 404) return INVALID_LINK;
  }
  return friendlyErrorMessage(e);
}

const UNAVAILABLE: Record<Exclude<InviteInfo["status"], "pending">, [string, string]> = {
  expired: [
    "This invite has expired.",
    "Ask the person who invited you to send a new one.",
  ],
  revoked: [
    "This invite was withdrawn.",
    "If you still need access, ask the person who invited you for a new invite.",
  ],
  accepted: ["This invite has already been used.", ""],
};

/** Landing page for an invite link (`/invite/:token`). Three ways in:
 * - signed in: "Join" redeems the invite for the current account;
 * - signed out, with an account: "Sign in to accept" goes to /login and
 *   comes back here afterwards;
 * - signed out, no account: "Create account" registers WITH the invite token,
 *   which accepts the invite in the same step, then signs in and lands in the
 *   team/org. (Not offered where the instance has sign-up turned off, or when
 *   the invite can't create accounts: `can_create_account: false`.) */
export function InviteRedeemPage() {
  const { token: invitedTokenParam } = useParams<{ token: string }>();
  const inviteToken = invitedTokenParam ?? "";
  const { token, email: myEmail, isAuthenticated, loginWithToken } = useAuth();
  const navigate = useNavigate();
  useNoReferrer();
  // Only a signed-out visitor is offered sign-up, so only they need the mode.
  const registration = useRegistrationMode({ enabled: !isAuthenticated });

  const infoRes = useAsyncResource((signal) => fetchInvite(inviteToken, signal), {
    deps: [inviteToken],
  });

  const [redeeming, setRedeeming] = useState(false);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [signUpOutcome, setSignUpOutcome] = useState<SignUpOutcome | null>(null);
  // When the outcome replaces the form, focus moves to its next step (or the
  // message itself), so keyboard and screen-reader users aren't left on a
  // control that no longer exists.
  const outcomeRef = useRef<HTMLDivElement>(null);
  const outcomeActionRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (signUpOutcome) (outcomeActionRef.current ?? outcomeRef.current)?.focus();
  }, [signUpOutcome]);

  const info = infoRes.data;
  const invitePath = `/invite/${inviteToken}`;

  function signIn(returnTo: string = invitePath) {
    navigate("/login", { state: { from: returnTo } });
  }

  async function handleRedeem() {
    setRedeeming(true);
    setIsError(false);
    setStatus("");
    try {
      // #1071: the redeem response carries a fresh token with an up-to-date
      // `teams` JWT claim -- the token this page was already authenticated
      // with necessarily predates this exact membership change, and
      // /v1/auth/refresh never re-derives `teams`, so without swapping in
      // this new token the caller couldn't see the team's shared content
      // until an unrelated full logout/login.
      const sentAt = Date.now();
      const result = await apiFetch<{ access_token: string }>(
        `/v1/invites/by-token/${inviteToken}/redeem`,
        { method: "POST", token },
      );
      loginWithToken(result.access_token, sentAt);
      navigate(landingPath(info), { replace: true });
    } catch (e) {
      setStatus(redeemErrorMessage(e, info, myEmail));
      setIsError(true);
      setRedeeming(false);
      // No longer pending: re-read the invite, so the page says whether it
      // was withdrawn or used (the 409 is the same for both).
      if (e instanceof ApiError && e.status === 409) infoRes.reload();
    }
  }

  // An invite is either org-scoped or team-scoped; present whichever it is.
  const isOrg = !!info?.organization_id;
  const targetName = isOrg ? info?.org_name : info?.team_name;
  const targetRole = isOrg ? info?.org_role : info?.team_role;
  const signUpAllowed = !registration.loading && registration.mode !== "sso_only";
  // Only an existing account can accept this invite (its issuer may not admit
  // new accounts, #2186): offer sign-in, not a form the API would refuse.
  const existingAccountsOnly = info?.can_create_account === false;
  // `email_bound` decides, never the look of the address (#2190): when the API
  // reports it, `email` is masked and only a hint, and the visitor types the
  // full address. Only an older API without the field sends the real one,
  // which is then prefilled read-only.
  const inviteEmail = info?.email ?? "";
  const maskedEmail = info?.email_bound === true ? inviteEmail : "";
  const lockedEmail = info?.email_bound == null ? inviteEmail : "";

  return (
    <div className="mx-auto max-w-md">
      <PageHeader icon="mail" title="Invitation" />

      <StatusLine>{infoRes.loading ? "Loading invite…" : ""}</StatusLine>

      {infoRes.error && (
        <div role="alert">
          <InfoCallout icon="warning">{infoRes.error}</InfoCallout>
        </div>
      )}

      {info && info.status !== "pending" && (
        <div role="alert">
          <InfoCallout icon="warning">
            {UNAVAILABLE[info.status]?.[0] ?? `This invite is ${info.status}.`}{" "}
            {UNAVAILABLE[info.status]?.[1]}
            {info.status === "accepted" &&
              (isAuthenticated ? (
                <Link to={landingPath(info)} className="underline">
                  Go to {targetName ?? "your team"}
                </Link>
              ) : (
                <>
                  If you accepted it,{" "}
                  <Link to="/login" className="underline">
                    sign in
                  </Link>{" "}
                  to continue.
                </>
              ))}
          </InfoCallout>
        </div>
      )}

      {info && info.status === "pending" && (
        <>
          <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            {info.invited_by_name ? (
              <>
                <strong>{info.invited_by_name}</strong> invited you
              </>
            ) : (
              "You've been invited"
            )}{" "}
            to join <strong>{targetName}</strong>
            {isOrg ? " (organization)" : " (team)"} as a <strong>{targetRole}</strong>
            {info.email ? (
              <>
                {" "}
                (<span className="break-all">{info.email}</span>)
              </>
            ) : null}
            .
          </p>

          {isAuthenticated && (
            <>
              <button
                onClick={handleRedeem}
                disabled={redeeming}
                className={`w-full sm:w-auto ${primaryButtonClass}`}
              >
                {redeeming ? "Joining…" : `Join ${targetName}`}
              </button>
              <StatusLine isError={isError} className="mt-2">
                {status}
              </StatusLine>
            </>
          )}

          {!isAuthenticated && signUpOutcome && (
            <div
              role="alert"
              ref={outcomeRef}
              tabIndex={-1}
              className="flex flex-col gap-3 focus:outline-none"
            >
              <InfoCallout
                icon={signUpOutcome.kind === "refused" ? "warning" : "info"}
              >
                {signUpOutcome.message}
              </InfoCallout>
              {(signUpOutcome.kind === "created-not-signed-in" ||
                (signUpOutcome.kind === "refused" &&
                  signUpOutcome.refusal === "invite_cannot_create_account")) && (
                <button
                  type="button"
                  ref={outcomeActionRef}
                  onClick={() =>
                    signIn(
                      signUpOutcome.kind === "created-not-signed-in"
                        ? signUpLandingPath(signUpOutcome.landing, info)
                        : invitePath,
                    )
                  }
                  className={`w-full sm:w-auto ${primaryButtonClass}`}
                >
                  {signUpOutcome.kind === "created-not-signed-in"
                    ? "Sign in"
                    : "Sign in to accept"}
                </button>
              )}
            </div>
          )}

          {!isAuthenticated && !signUpOutcome && (
            <div className="flex flex-col gap-4">
              <section
                aria-labelledby="invite-signin-heading"
                className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <h2
                  id="invite-signin-heading"
                  className="text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Already have an account?
                </h2>
                <button
                  type="button"
                  onClick={() => signIn()}
                  className={`w-full sm:w-auto ${
                    existingAccountsOnly ? primaryButtonClass : secondaryButtonClass
                  }`}
                >
                  Sign in to accept
                </button>
              </section>

              {existingAccountsOnly && (
                <InfoCallout icon="lock">
                  This invite can only be accepted by someone who already has an
                  account: sign in to accept it. If you don't have an account yet,
                  ask an administrator of {targetName ?? "the organization"} for an
                  invite that creates one.
                </InfoCallout>
              )}

              {signUpAllowed && !existingAccountsOnly && (
                <InviteSignUpForm
                  inviteToken={inviteToken}
                  lockedEmail={lockedEmail}
                  maskedEmail={maskedEmail}
                  onSignedIn={(landing) =>
                    navigate(signUpLandingPath(landing, info), { replace: true })
                  }
                  onStopped={setSignUpOutcome}
                  onSignInInstead={() => signIn()}
                />
              )}

              {!existingAccountsOnly &&
                !registration.loading &&
                registration.mode === "sso_only" && (
                <InfoCallout icon="lock">
                  New accounts can't be created here on this instance.{" "}
                  {oidcLoginUrl
                    ? "Choose “Sign in to accept” above, then sign in with SSO; your account is set up the first time you do."
                    : "Ask an administrator to create an account for you, then sign in to accept."}
                </InfoCallout>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
