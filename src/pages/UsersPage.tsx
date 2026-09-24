import { useState } from "react";

import { useConfirm } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { EmptyState } from "../components/EmptyState";
import { InfoCallout } from "../components/InfoCallout";
import { PageHeader } from "../components/PageHeader";
import { StatusLine } from "../components/StatusLine";
import { apiFetch, friendlyErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { MIN_PASSWORD_LENGTH } from "../lib/password";
import {
  badgeClass,
  badgeTone,
  destructiveButtonClass,
  fieldHintClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../lib/ui";
import { useAsyncResource } from "../lib/useAsyncResource";

export interface ManagedUser {
  id: number;
  username: string;
  email: string;
  role: string;
  is_active: boolean;
  created_at: string | null;
  is_oidc_linked: boolean;
}

interface UsersResponse {
  users: ManagedUser[];
  total: number;
  limit: number;
  offset: number;
}

const ROLES = ["user", "admin"] as const;

function RoleControl({
  user,
  token,
  onChanged,
}: {
  user: ManagedUser;
  token: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);

  if (user.is_oidc_linked) {
    return (
      <span
        className={badgeClass}
        title="Managed by Authelia (SSO) group membership -- overwritten on every login, so it can't be changed here."
      >
        {user.role} (SSO-managed)
      </span>
    );
  }

  async function handleChange(role: string) {
    if (role === user.role) return;
    setBusy(true);
    setIsError(false);
    setStatus("");
    try {
      await apiFetch(`/v1/auth/users/${user.id}/role`, {
        method: "PATCH",
        token,
        body: { role },
      });
      onChanged();
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-1">
      <select
        className={`${inputClass} w-32`}
        value={user.role}
        disabled={busy}
        onChange={(e) => handleChange(e.target.value)}
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      {status && (
        <StatusLine isError={isError} className="mb-0">
          {status}
        </StatusLine>
      )}
    </div>
  );
}

/** Deactivate / reactivate an account (minderhq/minder#1803): the gateway's
 * soft, reversible kill-switch -- a deactivated account can't sign in
 * (password or SSO) or refresh its token, but its data stays intact. Hidden on
 * the caller's own row (the gateway refuses self-deactivation anyway); the
 * last-admin guard's 409 surfaces as a status message. */
function StatusControl({
  user,
  token,
  isSelf,
  onChanged,
}: {
  user: ManagedUser;
  token: string;
  isSelf: boolean;
  onChanged: () => void;
}) {
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  if (isSelf) return null;

  async function handleToggle() {
    const activate = !user.is_active;
    if (!activate) {
      const ok = await confirm({
        title: `Deactivate ${user.username}?`,
        message: `${user.username} will no longer be able to sign in or refresh their session. Their data is kept, and you can reactivate the account at any time.`,
        confirmLabel: "Deactivate",
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    setStatus("");
    try {
      await apiFetch(`/v1/auth/users/${user.id}/status`, {
        method: "PATCH",
        token,
        body: { is_active: activate },
      });
      onChanged();
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-1">
      {dialog}
      <button
        type="button"
        onClick={handleToggle}
        disabled={busy}
        className={secondaryButtonClass}
      >
        {user.is_active ? "Deactivate" : "Reactivate"}
      </button>
      {status && (
        <StatusLine isError className="mb-0">
          {status}
        </StatusLine>
      )}
    </div>
  );
}

type ResetMode = "generate" | "set";

interface ResetPasswordResult {
  user_id: number;
  mode: ResetMode;
  must_change_password: boolean;
  temporary_password: string | null;
}

/** Admin reset of another user's LOCAL password (minderhq/minder#1776):
 * either the admin types a new password or the gateway generates a strong
 * temporary one, which is shown exactly once here. Either way the user's
 * sessions are signed out and they must change it on next sign-in. Hidden on
 * the caller's own row (they use Settings -> Change password) and on
 * SSO-linked accounts (their password lives in Authelia; the gateway 409s). */
function ResetPasswordControl({
  user,
  token,
  isSelf,
}: {
  user: ManagedUser;
  token: string;
  isSelf: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ResetMode>("generate");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ResetPasswordResult | null>(null);
  const [copied, setCopied] = useState(false);

  if (isSelf || user.is_oidc_linked) return null;

  function close() {
    // Drop the one-time password from memory as soon as the dialog closes.
    setOpen(false);
    setMode("generate");
    setPassword("");
    setError("");
    setResult(null);
    setCopied(false);
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (mode === "set" && password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<ResetPasswordResult>(
        `/v1/auth/users/${user.id}/reset-password`,
        {
          method: "POST",
          token,
          body: mode === "set" ? { mode, new_password: password } : { mode },
        },
      );
      setPassword("");
      setResult(res);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
    setBusy(false);
  }

  async function handleCopy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setError("Couldn't copy. Select the password and copy it manually.");
    }
  }

  const tempPassword = result?.temporary_password ?? "";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={secondaryButtonClass}
      >
        Reset password
      </button>
      {open && (
        <div
          role="presentation"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onKeyDown={(e) => {
            if (e.key === "Escape" && !busy) close();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`reset-password-title-${user.id}`}
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl dark:bg-gray-900"
          >
            <h2
              id={`reset-password-title-${user.id}`}
              className="text-base font-semibold text-gray-900 dark:text-gray-100"
            >
              Reset password for {user.username}?
            </h2>
            {result ? (
              <div className="mt-2 flex flex-col gap-3 text-sm text-gray-600 dark:text-gray-400">
                <p>
                  {user.username}&apos;s password was reset and their sessions
                  were signed out. They must choose a new password the next time
                  they sign in.
                </p>
                {tempPassword && (
                  <div>
                    <label
                      htmlFor={`temp-password-${user.id}`}
                      className="mb-1 block font-medium text-gray-700 dark:text-gray-300"
                    >
                      Temporary password
                    </label>
                    <div className="flex gap-2">
                      <input
                        id={`temp-password-${user.id}`}
                        readOnly
                        value={tempPassword}
                        onFocus={(e) => e.target.select()}
                        className={`${inputClass} font-mono`}
                      />
                      <button
                        type="button"
                        onClick={() => handleCopy(tempPassword)}
                        className={secondaryButtonClass}
                      >
                        <Icon name="copy" size={15} />{" "}
                        {copied ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <p className={`${fieldHintClass} font-medium`}>
                      Shown once. It can&apos;t be retrieved again after you
                      close this dialog, so share it with {user.username} over a
                      secure channel now.
                    </p>
                  </div>
                )}
                {error && (
                  <StatusLine isError className="mb-0">
                    {error}
                  </StatusLine>
                )}
                <div className="flex justify-end">
                  <button
                    type="button"
                    autoFocus
                    onClick={close}
                    className={primaryButtonClass}
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form
                onSubmit={handleReset}
                className="mt-2 flex flex-col gap-3 text-sm text-gray-600 dark:text-gray-400"
              >
                <p>
                  This signs {user.username} out everywhere and makes them
                  choose a new password at their next sign-in.
                </p>
                <fieldset className="flex flex-col gap-2" disabled={busy}>
                  <legend className="sr-only">New password</legend>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`reset-mode-${user.id}`}
                      checked={mode === "generate"}
                      onChange={() => setMode("generate")}
                    />
                    Generate a temporary password
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`reset-mode-${user.id}`}
                      checked={mode === "set"}
                      onChange={() => setMode("set")}
                    />
                    Set a password
                  </label>
                  {mode === "set" && (
                    <div>
                      <label
                        htmlFor={`reset-new-password-${user.id}`}
                        className="sr-only"
                      >
                        New password for {user.username}
                      </label>
                      <input
                        id={`reset-new-password-${user.id}`}
                        type="password"
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="New password"
                        className={inputClass}
                      />
                      <p className={fieldHintClass}>
                        At least {MIN_PASSWORD_LENGTH} characters.
                      </p>
                    </div>
                  )}
                </fieldset>
                {error && (
                  <StatusLine isError className="mb-0">
                    {error}
                  </StatusLine>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    disabled={busy}
                    className={secondaryButtonClass}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className={destructiveButtonClass}
                  >
                    {busy ? "Resetting…" : "Reset password"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function UserRow({
  user,
  token,
  isSelf,
  onChanged,
}: {
  user: ManagedUser;
  token: string;
  isSelf: boolean;
  onChanged: () => void;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
      <div className="min-w-0">
        <div className="font-medium text-gray-900 dark:text-gray-100">
          {user.username}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {user.email}
        </div>
      </div>
      {!user.is_active && (
        <span className={`${badgeClass} ${badgeTone.danger}`}>disabled</span>
      )}
      <div className="ml-auto flex items-start gap-2">
        <RoleControl user={user} token={token} onChanged={onChanged} />
        <ResetPasswordControl user={user} token={token} isSelf={isSelf} />
        <StatusControl
          user={user}
          token={token}
          isSelf={isSelf}
          onChanged={onChanged}
        />
      </div>
    </div>
  );
}

/** Admin-only user list + role editor (issue #1043, Phase 1 of the
 * organizations/teams/RBAC plan, #1042) -- follows BackupsPage.tsx's
 * admin-gate pattern exactly. SSO-linked accounts show their role as
 * read-only: Authelia's group membership overwrites it on every login, so
 * editing it here would silently revert (see the ADR at
 * docs/architecture/organizations-teams-rbac.md). */
export function UsersPage() {
  const { token, role, userId } = useAuth();
  const isAdmin = role === "admin";

  const usersRes = useAsyncResource(
    (signal) => apiFetch<UsersResponse>("/v1/auth/users", { token, signal }),
    { enabled: isAdmin },
  );

  return (
    <>
      <PageHeader
        icon="users"
        title="Users"
        subtitle="Change a user's role, reset their password, or deactivate/reactivate their account. Admin-only. Accounts linked to Authelia SSO show their role as read-only — it's re-derived from Authelia's group membership on every login, so change it there instead."
      />

      {!isAdmin && (
        <InfoCallout icon="lock">
          {token
            ? "Admin role required to view or manage users."
            : "Log in as an admin to view or manage users."}
        </InfoCallout>
      )}

      {isAdmin && (
        <>
          <div className="mb-2 flex items-center gap-2">
            <button onClick={usersRes.reload} className={secondaryButtonClass}>
              <Icon name="reset" size={15} /> Refresh
            </button>
          </div>
          <StatusLine isError={!!usersRes.error}>
            {usersRes.error ?? (usersRes.loading ? "Loading…" : "")}
          </StatusLine>
          {usersRes.data?.users.length === 0 && (
            <EmptyState>No users found.</EmptyState>
          )}
          {usersRes.data?.users.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              token={token}
              isSelf={String(u.id) === userId}
              onChanged={usersRes.reload}
            />
          ))}
        </>
      )}
    </>
  );
}
