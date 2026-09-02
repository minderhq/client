import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { InfoCallout } from "../components/InfoCallout";
import { PageHeader } from "../components/PageHeader";
import { StatusLine } from "../components/StatusLine";
import { apiFetch, friendlyErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { primaryButtonClass } from "../lib/ui";
import { useAsyncResource } from "../lib/useAsyncResource";

interface InviteInfo {
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
}

/** Landing page for a shared invite link (`/invite/:token`). There is no
 * separate "create an account via the invite" step here -- a brand-new
 * person registers/logs in through the normal /login flow first (this page
 * just tells them to, and to come back to this same link afterward, since
 * LoginPage always redirects to "/" post-auth with no return-path support
 * yet), then redeems while authenticated. Works the same for an existing
 * local or OIDC-linked account. */
export function InviteRedeemPage() {
  const { token: invitedTokenParam } = useParams<{ token: string }>();
  const inviteToken = invitedTokenParam ?? "";
  const { token, isAuthenticated, loginWithToken } = useAuth();
  const navigate = useNavigate();

  const infoRes = useAsyncResource(
    (signal) =>
      apiFetch<InviteInfo>(`/v1/invites/by-token/${inviteToken}`, { signal }),
    { deps: [inviteToken] },
  );

  const [redeeming, setRedeeming] = useState(false);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);

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
      const result = await apiFetch<{ access_token: string }>(
        `/v1/invites/by-token/${inviteToken}/redeem`,
        { method: "POST", token },
      );
      loginWithToken(result.access_token);
      // Org invites land on the Organization page; team invites on Teams.
      navigate(infoRes.data?.organization_id ? "/organization" : "/platform/teams", {
        replace: true,
      });
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
      setRedeeming(false);
    }
  }

  // An invite is either org-scoped or team-scoped; present whichever it is.
  const info = infoRes.data;
  const isOrg = !!info?.organization_id;
  const targetName = isOrg ? info?.org_name : info?.team_name;
  const targetRole = isOrg ? info?.org_role : info?.team_role;

  return (
    <>
      <PageHeader icon="mail" title="Invitation" />

      <StatusLine isError={!!infoRes.error}>
        {infoRes.error ?? (infoRes.loading ? "Loading…" : "")}
      </StatusLine>

      {info && info.status !== "pending" && (
        <InfoCallout icon="warning">
          This invite is {info.status} and can no longer be redeemed.
        </InfoCallout>
      )}

      {info && info.status === "pending" && (
        <>
          <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            You've been invited to join{" "}
            <strong>{targetName}</strong>
            {isOrg ? " (organization)" : ""} as a <strong>{targetRole}</strong> (
            {info.email}).
          </p>

          {!isAuthenticated && (
            <InfoCallout icon="lock">
              Log in or create an account first, using the email address this
              invite was sent to, then come back to this same link to accept
              it. <Link to="/login" className="underline">Go to login</Link>
            </InfoCallout>
          )}

          {isAuthenticated && (
            <>
              <button
                onClick={handleRedeem}
                disabled={redeeming}
                className={primaryButtonClass}
              >
                {redeeming ? "Joining…" : `Join ${targetName}`}
              </button>
              <StatusLine isError={isError} className="mt-2">
                {status}
              </StatusLine>
            </>
          )}
        </>
      )}
    </>
  );
}
