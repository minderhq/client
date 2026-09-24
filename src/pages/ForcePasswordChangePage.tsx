import type { ReactNode } from "react";

import { InfoCallout } from "../components/InfoCallout";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../lib/auth";
import { secondaryButtonClass } from "../lib/ui";
import { ChangePasswordSection } from "./SettingsPage";

/** Shown in place of every route while `mustChangePassword` is set, i.e. the
 * login response said an admin reset this account's password
 * (minderhq/minder#1776). The admin knows the current password, so the user
 * must pick their own before using the app; a successful change clears the
 * flag server-side and here. */
export function ForcePasswordChangePage() {
  const { token, clearMustChangePassword, logout } = useAuth();

  return (
    <>
      <PageHeader
        icon="lock"
        title="Change your password"
        subtitle="An administrator reset your password. Choose a new one to continue."
      />
      <InfoCallout icon="lock" tone="warn">
        Enter the password your administrator gave you as the current password,
        then choose a new one that only you know.
      </InfoCallout>
      <ChangePasswordSection
        token={token}
        onChanged={clearMustChangePassword}
      />
      <button type="button" onClick={logout} className={secondaryButtonClass}>
        Sign out
      </button>
    </>
  );
}

/** Renders the forced change-password screen instead of `children` (the app's
 * routes) while the signed-in user must change their password (#1776). */
export function ForcePasswordChangeGate({ children }: { children: ReactNode }) {
  const { mustChangePassword } = useAuth();
  return mustChangePassword ? <ForcePasswordChangePage /> : <>{children}</>;
}
