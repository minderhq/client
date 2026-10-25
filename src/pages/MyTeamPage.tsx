import { Link } from "react-router-dom";

import { CardListSkeleton } from "../components/CardListSkeleton";
import { EmptyState } from "../components/EmptyState";
import { LoadError } from "../components/LoadError";
import { PageHeader } from "../components/PageHeader";
import { RequestButton } from "../components/RequestButton";
import { useI18n } from "../i18n";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ROUTES } from "../lib/routes";
import { useAsyncResource } from "../lib/useAsyncResource";
import { useCan, useMyTeamIds } from "../lib/useCan";
import { TeamCard, type TeamsResponse } from "./TeamsPage";

/** My team (BEN): the teams the caller belongs to, with the same member list
 * and team-admin controls as Organization › Teams (each card asks useCan for
 * its own team). A member of no team gets the org's teams to ask to join
 * (a `team_join` request to the team's admins). Org-wide team management is
 * Organization › Teams; holders of org.teams.manage get a link there. */
export function MyTeamPage() {
  const { token, username } = useAuth();
  const { t, plural } = useI18n();
  const myTeamIds = useMyTeamIds();
  const canManageAll = useCan("org.teams.manage");
  const teamsRes = useAsyncResource(
    (signal) => apiFetch<TeamsResponse>("/v1/teams", { token, signal, cache: true }),
    { enabled: !!token },
  );
  const teams = teamsRes.data?.teams;
  // Unknown membership (a gateway without /v1/me/permissions): every team,
  // each card offers its controls or Ask to join from the team's own roster.
  const mine =
    teams && myTeamIds !== undefined
      ? myTeamIds === null
        ? teams
        : teams.filter((team) => myTeamIds.has(String(team.id)))
      : undefined;

  return (
    <>
      <PageHeader icon="teams" title={t("nav.items.myTeam.title")} subtitle={t("myTeam.subtitle")} />
      {canManageAll && (
        <p className="mb-4 text-sm text-gray-700 dark:text-gray-300">
          {t("myTeam.manageAll")}{" "}
          <Link
            to={ROUTES.orgTeams}
            className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            {t("myTeam.openOrgTeams")}
          </Link>
        </p>
      )}
      {teamsRes.error ? (
        <LoadError
          title={t("myTeam.loadError")}
          message={teamsRes.error}
          onRetry={teamsRes.reload}
          what={t("nav.items.myTeam.title")}
        />
      ) : !mine || !teams ? (
        <CardListSkeleton />
      ) : mine.length > 0 ? (
        mine.map((team) => (
          <TeamCard
            key={team.id}
            team={team}
            token={token}
            currentUsername={username}
            onChanged={teamsRes.reload}
          />
        ))
      ) : canManageAll ? (
        <EmptyState>{t("myTeam.noTeamAdmin")}</EmptyState>
      ) : teams.length === 0 ? (
        <EmptyState>{t("myTeam.noTeams")}</EmptyState>
      ) : (
        <section>
          <h2 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t("myTeam.noTeamHeading")}
          </h2>
          <EmptyState className="mb-3">{t("myTeam.noTeam")}</EmptyState>
          {teams.map((team) => (
            <div
              key={team.id}
              className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700"
            >
              <span className="font-medium text-gray-900 dark:text-gray-100">{team.name}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {plural("teams.members", team.member_count)}
              </span>
              <span className="ml-auto">
                <RequestButton kind="team_join" teamId={team.id} name={team.name} />
              </span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
