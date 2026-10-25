import { useState } from "react";

import { useConfirm } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { InfoCallout } from "../components/InfoCallout";
import { PageHeader } from "../components/PageHeader";
import { RequestButton } from "../components/RequestButton";
import { StatusLine } from "../components/StatusLine";
import { useI18n } from "../i18n";
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
import { useCan } from "../lib/useCan";

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

export interface TeamsResponse {
  teams: Team[];
  total: number;
  limit: number;
  offset: number;
}

/** Organization › Teams (route gated on org.teams.manage): every team of the
 * org, created and managed here. A team's own admins manage it from My team,
 * which renders the same TeamCard. The server enforces every mutation
 * regardless of what this page shows -- these client checks only decide
 * which controls are worth rendering. */
export function TeamsPage() {
  const { token, username, loginWithToken } = useAuth();
  const { t } = useI18n();

  const teamsRes = useAsyncResource(
    (signal) => apiFetch<TeamsResponse>("/v1/teams", { token, signal, cache: true }),
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
      const sentAt = Date.now();
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
      loginWithToken(result.access_token, sentAt);
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
        title={t("nav.items.teams.title")}
        subtitle={t("teams.subtitle")}
      />

      {!token && (
        <InfoCallout icon="lock">{t("teams.loggedOut")}</InfoCallout>
      )}

      {token && (
        <>
          <section className="mb-6 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
              {t("teams.createHeading")}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("teams.namePlaceholder")}
                className={`${inlineInputClass} flex-1`}
                disabled={creating}
              />
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("teams.descriptionPlaceholder")}
                className={`${inlineInputClass} flex-1`}
                disabled={creating}
              />
              <button
                onClick={handleCreate}
                disabled={creating || !name.trim()}
                className={primaryButtonClass}
              >
                {creating ? t("teams.creating") : t("teams.create")}
              </button>
            </div>
            <StatusLine isError={createIsError} className="mb-0 mt-2">
              {createStatus}
            </StatusLine>
          </section>

          <StatusLine isError={!!teamsRes.error}>
            {teamsRes.error ?? (teamsRes.loading ? t("common.loading") : "")}
          </StatusLine>
          {teamsRes.data?.teams.length === 0 && (
            <EmptyState>{t("teams.empty")}</EmptyState>
          )}
          {teamsRes.data?.teams.map((t) => (
            <TeamCard
              key={t.id}
              team={t}
              token={token}
              currentUsername={username}
              onChanged={teamsRes.reload}
            />
          ))}
        </>
      )}
    </>
  );
}

export function TeamCard({
  team,
  token,
  currentUsername,
  onChanged,
}: {
  team: Team;
  token: string;
  currentUsername: string;
  onChanged: () => void;
}) {
  const { t, plural } = useI18n();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);

  async function load() {
    setStatus(t("common.loading"));
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
          {plural("teams.members", team.member_count)}
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
  onChanged,
}: {
  detail: TeamDetail;
  token: string;
  currentUsername: string;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const myMembership = detail.members.find((m) => m.username === currentUsername);
  // Who manages the org's teams adds people directly; others ask to join.
  const canManageTeams = useCan("org.teams.manage");
  // The server's team gate: team.members.manage on this team (own grant or
  // org-wide), org.teams.manage, or the Platform Admin. The team_role check
  // covers the role-claim fallback, which knows no team grants.
  const canManage =
    useCan("team.members.manage", { teamId: String(detail.id) }) ||
    canManageTeams ||
    myMembership?.team_role === "team_admin";

  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newRole, setNewRole] = useState<"member" | "team_admin">("member");
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirm();

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
      t("teams.added", { email }),
    );
    setNewMemberEmail("");
  }

  async function handleRemoveMember(member: TeamDetail["members"][number]) {
    const isSelf = member.username === currentUsername;
    const ok = await confirm({
      title: isSelf ? t("teams.leaveTitle") : t("teams.removeTitle", { name: member.username }),
      message: isSelf
        ? t("teams.leaveMessage")
        : t("teams.removeMessage", { name: member.username }),
      confirmLabel: isSelf ? t("teams.leave") : t("teams.remove"),
      danger: true,
    });
    if (!ok) return;
    await run(() =>
      apiFetch(`/v1/teams/${detail.id}/members/${member.user_id}`, {
        method: "DELETE",
        token,
      }),
    );
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
            {t(`teams.roles.${m.team_role}`)}
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
                <option value="member">{t("teams.roles.member")}</option>
                <option value="team_admin">{t("teams.roles.team_admin")}</option>
              </select>
            )}
            {(canManage || m.username === currentUsername) && (
              <button
                onClick={() => handleRemoveMember(m)}
                disabled={busy}
                className={destructiveButtonClass}
              >
                {m.username === currentUsername ? t("teams.leave") : t("teams.remove")}
              </button>
            )}
          </div>
        </div>
      ))}

      {!myMembership && !canManage && !canManageTeams && (
        <div className="mt-3">
          <RequestButton kind="team_join" teamId={detail.id} name={detail.name} />
        </div>
      )}

      {canManage && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="email"
            value={newMemberEmail}
            onChange={(e) => setNewMemberEmail(e.target.value)}
            placeholder={t("teams.memberEmailPlaceholder")}
            className={`${inlineInputClass} w-56`}
            disabled={busy}
          />
          <select
            className={`${inputClass} w-32`}
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as "member" | "team_admin")}
            disabled={busy}
          >
            <option value="member">{t("teams.roles.member")}</option>
            <option value="team_admin">{t("teams.roles.team_admin")}</option>
          </select>
          <button
            onClick={handleAddMember}
            disabled={busy || !newMemberEmail.trim()}
            className={secondaryButtonClass}
          >
            {t("teams.addMember")}
          </button>
        </div>
      )}
      <StatusLine isError={isError} className="mt-2">
        {status}
      </StatusLine>

      {canManage && <InvitesSection teamId={detail.id} token={token} />}
      {dialog}
    </div>
  );
}

function InvitesSection({ teamId, token }: { teamId: number; token: string }) {
  const { t } = useI18n();
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
        {t("teams.invitesHeading")}
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("teams.inviteEmailPlaceholder")}
          className={`${inlineInputClass} flex-1`}
          disabled={busy}
        />
        <select
          className={`${inputClass} w-32`}
          value={role}
          onChange={(e) => setRole(e.target.value as "member" | "team_admin")}
          disabled={busy}
        >
          <option value="member">{t("teams.roles.member")}</option>
          <option value="team_admin">{t("teams.roles.team_admin")}</option>
        </select>
        <button
          onClick={handleSendInvite}
          disabled={busy || !email.trim()}
          className={secondaryButtonClass}
        >
          {t("teams.sendInvite")}
        </button>
      </div>
      {newLink && (
        <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
          {t("teams.inviteLink")}{" "}
          <span className="font-mono">{newLink}</span>
        </p>
      )}
      <StatusLine isError={isError} className="mt-2">
        {status}
      </StatusLine>
      <StatusLine isError={!!invitesRes.error} className="mt-2">
        {invitesRes.error ?? (invitesRes.loading ? t("common.loading") : "")}
      </StatusLine>
      {invitesRes.data?.invites.map((inv) => (
        <div
          key={inv.id}
          className="mt-2 flex flex-wrap items-center gap-2 text-xs"
        >
          <span className="text-gray-900 dark:text-gray-100">{inv.email}</span>
          <span className={badgeClass}>{t(`teams.roles.${inv.team_role}`)}</span>
          <span
            className={`${badgeClass} ${
              inv.status === "accepted" ? badgeTone.success : ""
            }`}
          >
            {t(`teams.inviteStatus.${inv.status}`)}
          </span>
          {inv.status === "pending" && (
            <button
              onClick={() => handleRevoke(inv.id)}
              disabled={busy}
              className={destructiveButtonClass}
            >
              {t("teams.revoke")}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
