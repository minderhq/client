import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

import { InfoCallout } from "../components/InfoCallout";
import { PageHeader } from "../components/PageHeader";
import {
  ApiError,
  EMAIL_VERIFICATION_REQUIRED_EVENT,
  friendlyErrorMessage,
  WORKSPACE_REQUIRED_EVENT,
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { fetchMyOrgs, type MyOrg } from "../lib/orgs";
import {
  createPersonalWorkspace,
  fetchMyProfile,
  normalizeWorkspaceState,
  type UserProfile,
  type WorkspaceState,
} from "../lib/profile";
import { isGateExemptPath } from "../lib/recoveryRoutes";
import { primaryButtonClass, secondaryButtonClass } from "../lib/ui";
import { useTokenRef } from "../lib/useTokenRef";
import { CheckEmailPage } from "./CheckEmailPage";

/** Routes a workspace-less account may still use: a tenant-less token can
 * redeem an invite (that is how an admin brings it into an org), plus the
 * sign-in pages. Matched on the first path segment. */
function isWorkspaceExemptPath(pathname: string): boolean {
  if (isGateExemptPath(pathname)) return true;
  return /^\/(invite|login|auth)(\/|$)/i.test(pathname);
}

/** The waiting room for an account with no workspace (#116, minder#2234).
 *
 * - `none` / `pending_request`: offers "Create my workspace" when the server
 *   says the account may (`canCreate`), otherwise says an admin has to invite
 *   the user. Requesting access is minder#2235 and not built yet.
 * - `ready` (but tenant-less): the account belongs to organizations but its
 *   token has none active, so list them to switch into. */
export function WaitingRoomPage({
  state,
  canCreate,
}: {
  state: WorkspaceState;
  canCreate: boolean;
}) {
  const { sessionKey, loginWithToken, switchOrg, logout } = useAuth();
  const tokenRef = useTokenRef();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [orgs, setOrgs] = useState<MyOrg[] | null>(null);

  useEffect(() => {
    const token = tokenRef.current;
    if (state !== "ready" || !token) return;
    const ctrl = new AbortController();
    fetchMyOrgs(token, ctrl.signal)
      .then((r) => setOrgs(r.organizations))
      .catch((e) => {
        if (!ctrl.signal.aborted) {
          setOrgs([]);
          setError(friendlyErrorMessage(e));
        }
      });
    return () => ctrl.abort();
  }, [state, sessionKey, tokenRef]);

  const create = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const sentAt = Date.now();
      const created = await createPersonalWorkspace(tokenRef.current);
      // Store the new, tenanted token like a login token; the gate re-reads
      // the profile for the new session and lets the app through.
      loginWithToken(created.access_token, sentAt);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 409
          ? "You already have a workspace. Reload the page to continue."
          : friendlyErrorMessage(e),
      );
      setBusy(false);
    }
  }, [tokenRef, loginWithToken]);

  const choose = useCallback(
    async (org: MyOrg) => {
      setBusy(true);
      setError("");
      try {
        await switchOrg(org.id);
      } catch (e) {
        setError(friendlyErrorMessage(e));
        setBusy(false);
      }
    },
    [switchOrg],
  );

  const signOut = (
    <button type="button" onClick={logout} className={secondaryButtonClass}>
      Sign out
    </button>
  );
  const errorLine = error ? (
    <p role="alert" className="text-sm text-red-600 dark:text-red-400">
      {error}
    </p>
  ) : null;

  if (state === "ready") {
    return (
      <>
        <PageHeader
          icon="org"
          title="Choose an organization"
          subtitle="You belong to an organization, but none is active right now. Pick one to continue."
        />
        {orgs === null ? (
          <p className="text-sm text-gray-500">Loading your organizations…</p>
        ) : (
          <ul className="space-y-2">
            {orgs.map((org) => (
              <li key={org.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => choose(org)}
                  className={secondaryButtonClass}
                >
                  {org.name}
                  <span className="ml-2 text-xs uppercase text-gray-400">
                    {org.org_role}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {errorLine}
        {signOut}
      </>
    );
  }

  return (
    <>
      <PageHeader
        icon="org"
        title="No workspace yet"
        subtitle={
          state === "pending_request"
            ? "Your request to join an organization is waiting for approval."
            : "Your account isn't part of a workspace yet."
        }
      />
      {canCreate ? (
        <>
          <InfoCallout icon="info">
            A workspace is where your knowledge bases, models and plugins live.
            Create your own, or ask an administrator to invite you to an
            existing one.
          </InfoCallout>
          <button
            type="button"
            disabled={busy}
            onClick={create}
            className={primaryButtonClass}
          >
            {busy ? "Creating…" : "Create my workspace"}
          </button>
        </>
      ) : (
        <InfoCallout icon="info">
          An administrator has to invite you to a workspace before you can use
          Minder. Ask one to send you an invite link, then open it here.
        </InfoCallout>
      )}
      {/* Request access (minder#2235) is not built yet; it goes here. */}
      {errorLine}
      {signOut}
    </>
  );
}

/** Renders "Check your email" instead of `children` (the app's routes) while
 * the signed-in account must still confirm its email address (#2447): the
 * profile says `email_verification_required`, a request came back `403
 * email_verification_required`, or (until the profile arrives, or when it
 * can't say) the login response said so. That comes before the workspace: an
 * open sign-up gets its workspace only once verified.
 *
 * Otherwise renders the waiting room instead of `children` while the
 * signed-in account has no usable workspace (#116): the profile says
 * `workspace_state` is `none`/`pending_request` (or unknown), a request came
 * back `403 workspace_required`, or the account is `ready` but its token has no
 * tenant. A profile that can't be read, or that predates the field, lets the
 * app through (the API still enforces access). Never logs out. */
export function WorkspaceGate({ children }: { children: ReactNode }) {
  const {
    isAuthenticated,
    mustChangePassword,
    sessionKey,
    tenantId,
    activeTenantId,
    emailVerificationRequired,
  } = useAuth();
  const tokenRef = useTokenRef();
  const { pathname } = useLocation();
  const [profile, setProfile] = useState<{
    key: string;
    data: UserProfile | null;
  } | null>(null);
  const [requiredKey, setRequiredKey] = useState("");
  const [verificationKey, setVerificationKey] = useState("");

  // `token` changes on every silent refresh; the session (sessionKey) doesn't.
  useEffect(() => {
    const token = tokenRef.current;
    if (!isAuthenticated || !token) return;
    const ctrl = new AbortController();
    fetchMyProfile(token, ctrl.signal)
      .then((data) => setProfile({ key: sessionKey, data }))
      .catch(() => {
        if (!ctrl.signal.aborted) setProfile({ key: sessionKey, data: null });
      });
    return () => ctrl.abort();
  }, [isAuthenticated, sessionKey, tokenRef]);

  useEffect(() => {
    const onRequired = () => setRequiredKey(sessionKey);
    window.addEventListener(WORKSPACE_REQUIRED_EVENT, onRequired);
    return () => window.removeEventListener(WORKSPACE_REQUIRED_EVENT, onRequired);
  }, [sessionKey]);

  useEffect(() => {
    const onRequired = () => setVerificationKey(sessionKey);
    window.addEventListener(EMAIL_VERIFICATION_REQUIRED_EVENT, onRequired);
    return () =>
      window.removeEventListener(EMAIL_VERIFICATION_REQUIRED_EVENT, onRequired);
  }, [sessionKey]);

  // A forced password change comes first (ForcePasswordChangeGate).
  if (!isAuthenticated || mustChangePassword || isWorkspaceExemptPath(pathname)) {
    return <>{children}</>;
  }
  const loaded = profile?.key === sessionKey ? profile.data : null;
  const required = requiredKey === sessionKey;
  // Until the profile for this session arrives the app renders as usual (a
  // tenant call that fails meanwhile raises `required` above).

  const profileSays = loaded?.email_verification_required;
  if (
    profileSays === true ||
    verificationKey === sessionKey ||
    (typeof profileSays !== "boolean" && emailVerificationRequired)
  ) {
    return <CheckEmailPage />;
  }

  const state = normalizeWorkspaceState(loaded?.workspace_state);
  const hasTenant = Boolean(activeTenantId || tenantId);
  if (state === "ready" && (!hasTenant || required)) {
    return <WaitingRoomPage state="ready" canCreate={false} />;
  }
  if (
    state === "none" ||
    state === "pending_request" ||
    (required && state === null)
  ) {
    return (
      <WaitingRoomPage
        state={state ?? "none"}
        canCreate={loaded?.can_create_workspace === true}
      />
    );
  }
  return <>{children}</>;
}
