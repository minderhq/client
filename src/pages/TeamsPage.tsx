import { useState } from "react";

import { EmptyState } from "../components/EmptyState";
import { InfoCallout } from "../components/InfoCallout";
import { PageHeader } from "../components/PageHeader";
import { StatusLine } from "../components/StatusLine";
import { apiFetch, friendlyErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  badgeClass,
  badgeTone,
  destructiveButtonClass,
  inlineInputClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../lib/ui";
import { useAsyncResource } from "../lib/useAsyncResource";

export interface Team {
  id: number;
  name: string;
  description: string | null;
  created_by: number | null;
  created_at: string | null;
  member_count: number;
}

export interface TeamMember {
  user_id: number;
  username: string;
  email: string;
  team_role: "member" | "team_admin";
  joined_at: string | null;
}

export interface TeamDetail extends Omit<Team, "member_count"> {
  members: TeamMember[];
}

export interface Invite {
  id: number;
  email: string;
  team_id: number;
  team_role: "member" | "team_admin";
  invited_by: number | null;
  token: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  created_at: string | null;
  expires_at: string | null;
}

interface InvitesResponse {
  invites: Invite[];
  total: number;
  limit: number;
  offset: number;
}

interface TeamsResponse {
  teams: Team[];
  total: number;
  limit: number;
  offset: number;
}

/** Any authenticated user can create/browse teams (the ADR's own openness --
 * a team roster isn't sensitive); mutating a specific team's membership or
 * settings requires that team's own team_admin or an instance admin, which
 * the server enforces regardless of what this page shows -- these client
 * checks only decide which controls are worth rendering. */
export function TeamsPage() {
  const { token, username, role, loginWithToken } = useAuth();
  const isInstanceAdmin = role === "admin";

  const teamsRes = useAsyncResource(
    (signal) => apiFetch<TeamsResponse>("/v1/teams", { token, signal }),
    { enabled: !!token },
  );

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createStatus, setCreateStatus] = useState("");
  const [createIsError, setCreateIsError] = useState(false);

  async function handleCreate() {
    setCreating(true);
    setCreateIsError(false);
    setCreateStatus("");
    try {
      const result = await apiFetch<{ access_token: string }>("/v1/teams", {
        method: "POST",
        token,
        body: { name, description: description || null },
      });
      // #1148: the creator becomes this team's team_admin at this exact
      // moment -- store the fresh token the server mints alongside it, or
      // this browser's session couldn't share anything with the new team
      // until an unrelated full logout/login (same fix shape as #1071's
      // invite-redeem token refresh).
      loginWithToken(result.access_token);
      setName("");
      setDescription("");
      teamsRes.reload();
    } catch (e) {
      setCreateStatus(friendlyErrorMessage(e));
      setCreateIsError(true);
    }
    setCreating(false);
  }

  return (
    <>
      <PageHeader
        icon="teams"
        title="Teams"
        subtitle="Group users into teams. Any logged-in user can create a team (and becomes its team admin); managing a team's membership or settings needs that team's own team admin, or an instance admin."
      />

      {!token && (
        <InfoCallout icon="lock">Log in to view or create teams.</InfoCallout>
      )}

      {token && (
        <>
          <section className="mb-6 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
              Create a Team
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Team name"
                className={`${inlineInputClass} flex-1`}
                disabled={creating}
              />
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description (optional)"
                className={`${inlineInputClass} flex-1`}
                disabled={creating}
              />
              <button
                onClick={handleCreate}
                disabled={creating || !name.trim()}
                className={primaryButtonClass}
              >
                {creating ? "Creating…" : "Create Team"}
              </button>
            </div>
            <StatusLine isError={createIsError} className="mb-0 mt-2">
              {createStatus}
            </StatusLine>
          </section>

          <StatusLine isError={!!teamsRes.error}>
            {teamsRes.error ?? (teamsRes.loading ? "Loading…" : "")}
          </StatusLine>
          {teamsRes.data?.teams.length === 0 && (
            <EmptyState>No teams yet — create one above.</EmptyState>
          )}
          {teamsRes.data?.teams.map((t) => (
            <TeamCard
              key={t.id}
              team={t}
              token={token}
              currentUsername={username}
              isInstanceAdmin={isInstanceAdmin}
              onChanged={teamsRes.reload}
            />
          ))}
        </>
      )}
    </>
  );
}

function TeamCard({
  team,
  token,
  currentUsername,
  isInstanceAdmin,
  onChanged,
}: {
  team: Team;
  token: string;
  currentUsername: string;
  isInstanceAdmin: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);

  async function load() {
    setStatus("Loading…");
    setIsError(false);
    try {
      const d = await apiFetch<TeamDetail>(`/v1/teams/${team.id}`, { token });
      setDetail(d);
      setLoaded(true);
      setStatus("");
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    }
  }

  async function handleToggle(e: React.SyntheticEvent<HTMLDetailsElement>) {
    setOpen(e.currentTarget.open);
    if (e.currentTarget.open && !loaded) {
      await load();
    }
  }

  return (
    <details
      className="mb-2 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700"
      onToggle={handleToggle}
    >
      <summary className="cursor-pointer">
        <span className="font-medium text-gray-900 dark:text-gray-100">
          {team.name}
        </span>{" "}
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {team.member_count} member{team.member_count === 1 ? "" : "s"}
        </span>
        {team.description && (
          <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
            {team.description}
          </span>
        )}
      </summary>
      <div className="mt-3">
        <StatusLine isError={isError}>{status}</StatusLine>
        {open && loaded && detail && (
          <TeamDetailPanel
            detail={detail}
            token={token}
            currentUsername={currentUsername}
            isInstanceAdmin={isInstanceAdmin}
            onChanged={async () => {
              await load();
              onChanged();
            }}
          />
        )}
      </div>
    </details>
  );
}

function TeamDetailPanel({
  detail,
  token,
  currentUsername,
  isInstanceAdmin,
  onChanged,
}: {
  detail: TeamDetail;
  token: string;
  currentUsername: string;
  isInstanceAdmin: boolean;
  onChanged: () => void;
}) {
  const myMembership = detail.members.find((m) => m.username === currentUsername);
  const canManage = isInstanceAdmin || myMembership?.team_role === "team_admin";

  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newRole, setNewRole] = useState<"member" | "team_admin">("member");
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, successMessage = "") {
    setBusy(true);
    setIsError(false);
    setStatus("");
    try {
      await action();
      if (successMessage) setStatus(successMessage);
      onChanged();
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    }
    setBusy(false);
  }

  async function handleAddMember() {
    const email = newMemberEmail.trim();
    if (!email) return;
    // #1072: by email, not a raw numeric user_id -- the only way to
    // discover an id (the admin-only Users page) isn't available to a
    // team_admin who isn't also an instance admin, so this control was
    // previously unusable for the majority of team_admins. The server
    // resolves the email to a user id itself.
    // #1148: unlike team creation (where the server mints the creator a fresh
    // token we swap in immediately), the added member isn't the caller and may
    // be offline, so we can't refresh THEIR JWT here. Their `teams` claim is
    // minted at login only, so they must log out and back in before team-shared
    // content becomes visible to them -- surface that explicitly rather than
    // leaving a silent staleness window.
    await run(
      () =>
        apiFetch(`/v1/teams/${detail.id}/members`, {
          method: "POST",
          token,
          body: { email, team_role: newRole },
        }),
      `Added ${email}. They must log out and back in before team-shared content becomes visible to them.`,
    );
    setNewMemberEmail("");
  }

  return (
    <div>
      {detail.members.map((m) => (
        <div
          key={m.user_id}
          className="mb-1 flex flex-wrap items-center gap-2 border-b border-gray-100 py-1 dark:border-gray-800"
        >
          <span className="text-gray-900 dark:text-gray-100">{m.username}</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">{m.email}</span>
          <span
            className={`${badgeClass} ${
              m.team_role === "team_admin" ? badgeTone.success : ""
            }`}
          >
            {m.team_role}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {canManage && (
              <select
                className={`${inputClass} w-32`}
                value={m.team_role}
                disabled={busy}
                onChange={(e) =>
                  run(() =>
                    apiFetch(`/v1/teams/${detail.id}/members/${m.user_id}`, {
                      method: "PATCH",
                      token,
                      body: { team_role: e.target.value },
                    }),
                  )
                }
              >
                <option value="member">member</option>
                <option value="team_admin">team_admin</option>
              </select>
            )}
            {(canManage || m.username === currentUsername) && (
              <button
                onClick={() =>
                  run(() =>
                    apiFetch(`/v1/teams/${detail.id}/members/${m.user_id}`, {
                      method: "DELETE",
                      token,
                    }),
                  )
                }
                disabled={busy}
                className={destructiveButtonClass}
              >
                {m.username === currentUsername ? "Leave" : "Remove"}
              </button>
            )}
          </div>
        </div>
      ))}

      {canManage && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="email"
            value={newMemberEmail}
            onChange={(e) => setNewMemberEmail(e.target.value)}
            placeholder="Existing member's email"
            className={`${inlineInputClass} w-56`}
            disabled={busy}
          />
          <select
            className={`${inputClass} w-32`}
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as "member" | "team_admin")}
            disabled={busy}
          >
            <option value="member">member</option>
            <option value="team_admin">team_admin</option>
          </select>
          <button
            onClick={handleAddMember}
            disabled={busy || !newMemberEmail.trim()}
            className={secondaryButtonClass}
          >
            Add Member
          </button>
        </div>
      )}
      <StatusLine isError={isError} className="mt-2">
        {status}
      </StatusLine>

      {canManage && <InvitesSection teamId={detail.id} token={token} />}
    </div>
  );
}

function InvitesSection({ teamId, token }: { teamId: number; token: string }) {
  const invitesRes = useAsyncResource(
    (signal) =>
      apiFetch<InvitesResponse>(`/v1/invites?team_id=${teamId}`, {
        token,
        signal,
      }),
    { deps: [teamId] },
  );
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "team_admin">("member");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [newLink, setNewLink] = useState("");

  async function handleSendInvite() {
    setBusy(true);
    setIsError(false);
    setStatus("");
    setNewLink("");
    try {
      const invite = await apiFetch<Invite>("/v1/invites", {
        method: "POST",
        token,
        body: { email, team_id: teamId, team_role: role },
      });
      setNewLink(`${window.location.origin}/invite/${invite.token}`);
      setEmail("");
      invitesRes.reload();
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    }
    setBusy(false);
  }

  async function handleRevoke(inviteId: number) {
    setBusy(true);
    setIsError(false);
    setStatus("");
    try {
      await apiFetch(`/v1/invites/${inviteId}/revoke`, {
        method: "POST",
        token,
      });
      invitesRes.reload();
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    }
    setBusy(false);
  }

  return (
    <div className="mt-4 border-t border-gray-200 pt-3 dark:border-gray-800">
      <h3 className="mb-2 text-xs font-semibold text-gray-900 dark:text-gray-100">
        Invites
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email address"
          className={`${inlineInputClass} flex-1`}
          disabled={busy}
        />
        <select
          className={`${inputClass} w-32`}
          value={role}
          onChange={(e) => setRole(e.target.value as "member" | "team_admin")}
          disabled={busy}
        >
          <option value="member">member</option>
          <option value="team_admin">team_admin</option>
        </select>
        <button
          onClick={handleSendInvite}
          disabled={busy || !email.trim()}
          className={secondaryButtonClass}
        >
          Send Invite
        </button>
      </div>
      {newLink && (
        <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
          Share this link with the invitee (no email is sent automatically):{" "}
          <span className="font-mono">{newLink}</span>
        </p>
      )}
      <StatusLine isError={isError} className="mt-2">
        {status}
      </StatusLine>
      <StatusLine isError={!!invitesRes.error} className="mt-2">
        {invitesRes.error ?? (invitesRes.loading ? "Loading…" : "")}
      </StatusLine>
      {invitesRes.data?.invites.map((inv) => (
        <div
          key={inv.id}
          className="mt-2 flex flex-wrap items-center gap-2 text-xs"
        >
          <span className="text-gray-900 dark:text-gray-100">{inv.email}</span>
          <span className={badgeClass}>{inv.team_role}</span>
          <span
            className={`${badgeClass} ${
              inv.status === "accepted" ? badgeTone.success : ""
            }`}
          >
            {inv.status}
          </span>
          {inv.status === "pending" && (
            <button
              onClick={() => handleRevoke(inv.id)}
              disabled={busy}
              className={destructiveButtonClass}
            >
              Revoke
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
