import { useState } from "react";

import { Icon } from "../components/Icon";
import { EmptyState } from "../components/EmptyState";
import { InfoCallout } from "../components/InfoCallout";
import { PageHeader } from "../components/PageHeader";
import { StatusLine } from "../components/StatusLine";
import { apiFetch, friendlyErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { badgeClass, badgeTone, inputClass, secondaryButtonClass } from "../lib/ui";
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

function UserRow({
  user,
  token,
  onChanged,
}: {
  user: ManagedUser;
  token: string;
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
      <div className="ml-auto">
        <RoleControl user={user} token={token} onChanged={onChanged} />
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
  const { token, role } = useAuth();
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
        subtitle="Change a user's role. Admin-only. Accounts linked to Authelia SSO show their role as read-only — it's re-derived from Authelia's group membership on every login, so change it there instead."
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
              onChanged={usersRes.reload}
            />
          ))}
        </>
      )}
    </>
  );
}
