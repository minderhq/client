import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";

import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { InfoCallout } from "../components/InfoCallout";
import { OrgDefaultLanguage } from "../components/OrgDefaultLanguage";
import { PageHeader } from "../components/PageHeader";
import { StatusLine } from "../components/StatusLine";
import { useI18n } from "../i18n";
import { friendlyErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  fetchMyOrgs,
  type MyOrg,
  orgRoleTone,
  pickActiveOrg,
  updateOrganization,
} from "../lib/orgs";
import { ROUTES } from "../lib/routes";
import {
  badgeClass,
  cardClass,
  inputClass,
  mutedTextClass,
  primaryButtonClass,
} from "../lib/ui";
import { useAsyncResource } from "../lib/useAsyncResource";
import { useCan } from "../lib/useCan";

/** The Organization home: which org you're acting in and its details.
 * Together with the topbar OrgSwitcher this is where multi-org membership
 * becomes legible: a user can be owner of one org and admin of another, and
 * both appear here / in the switcher. Members, invites and roles live in
 * Organization › People (linked); team-level membership stays on the Teams
 * page (linked). */
export function OrganizationPage() {
  const { isAuthenticated, token, sessionKey, activeTenantId, orgRole } = useAuth();
  // Member management (People links) is org.members.manage; the org PATCH
  // (name, description, default language) is org.settings.manage. useCan
  // grants both to the Platform Admin.
  const canManage = useCan("org.members.manage");
  const canEditSettings = useCan("org.settings.manage");
  const canManageTeams = useCan("org.teams.manage");
  const { t } = useI18n();

  // #1503: edit the active org's own name/description.
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editStatus, setEditStatus] = useState("");
  const [editIsError, setEditIsError] = useState(false);
  const editNameId = useId();
  const editDescriptionId = useId();

  const orgsRes = useAsyncResource<MyOrg[]>(
    (signal) => fetchMyOrgs(token, signal).then((r) => r.organizations),
    { deps: [sessionKey], enabled: isAuthenticated },
  );

  const orgs = orgsRes.data ?? [];
  const active = pickActiveOrg(orgs, activeTenantId);

  // Sync the edit form's fields whenever the active org changes (initial load,
  // org switch, or a reload after a successful save) -- but only from the
  // server's own values, never overwriting mid-edit input the user is
  // actively typing into a DIFFERENT org's form (keyed on active?.id so a
  // reload of the SAME org after save re-syncs to the just-saved values).
  useEffect(() => {
    setEditName(active?.name ?? "");
    setEditDescription(active?.description ?? "");
  }, [active?.id, active?.name, active?.description]);

  async function handleUpdateOrg(e: React.FormEvent) {
    e.preventDefault();
    if (!active || !editName.trim()) return;
    setEditBusy(true);
    setEditStatus("Saving…");
    setEditIsError(false);
    try {
      await updateOrganization(
        active.id,
        { name: editName.trim(), description: editDescription.trim() },
        token,
      );
      await orgsRes.reload();
      setEditStatus("Organization updated.");
    } catch (err) {
      setEditStatus(friendlyErrorMessage(err));
      setEditIsError(true);
    } finally {
      setEditBusy(false);
    }
  }

  if (!isAuthenticated) {
    return (
      <>
        <PageHeader
          icon="org"
          title="Organization"
          subtitle="Your organization, its members, and switching between the orgs you belong to."
        />
        <InfoCallout icon="lock">Log in to view your organization.</InfoCallout>
      </>
    );
  }

  return (
    <>
      <PageHeader
        icon="org"
        title="Organization"
        subtitle="Your organization, its members, and switching between the orgs you belong to."
      />

      <StatusLine isError={!!orgsRes.error}>
        {orgsRes.error ?? (orgsRes.loading && !orgsRes.data ? "Loading…" : "")}
      </StatusLine>

      {orgsRes.data && orgs.length === 0 && (
        <EmptyState>
          You don't belong to any organization yet. Organizations are provisioned
          by an administrator.
        </EmptyState>
      )}

      {active && (
        <>
          {/* Which org am I in right now. */}
          <section className={`mb-4 ${cardClass}`}>
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100 dark:bg-indigo-950/50 dark:text-indigo-300 dark:ring-indigo-900">
                <Icon name="org" size={22} />
              </span>
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
                  {active.name}
                  {active.is_home && <span className={badgeClass}>home</span>}
                </h2>
                <p className={`mt-0.5 ${mutedTextClass}`}>
                  <code>{active.slug}</code> · you are{" "}
                  <span className={`${badgeClass} ${orgRoleTone(orgRole || active.org_role)}`}>
                    {orgRole || active.org_role}
                  </span>{" "}
                  here
                </p>
              </div>
            </div>
            {orgs.length > 1 && (
              <p className={`mt-3 ${mutedTextClass}`}>
                You belong to {orgs.length} organizations — use the{" "}
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  organization switcher
                </span>{" "}
                in the top bar to change which one you're working in.
              </p>
            )}
          </section>

          {/* #1503: edit the active org's own name/description. Same gate as
            the org PATCH: org.settings.manage. */}
          {canEditSettings && (
            <section className={`mb-4 ${cardClass}`}>
              <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
                <Icon name="edit" size={17} className="text-indigo-500 dark:text-indigo-400" />
                Organization details
              </h2>
              <form onSubmit={handleUpdateOrg} className="flex flex-col gap-3">
                <div>
                  <label htmlFor={editNameId} className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                    Name
                  </label>
                  <input
                    id={editNameId}
                    type="text"
                    className={inputClass}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    disabled={editBusy}
                    maxLength={200}
                    required
                  />
                </div>
                <div>
                  <label htmlFor={editDescriptionId} className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                    Description
                  </label>
                  <textarea
                    id={editDescriptionId}
                    className={`${inputClass} min-h-20`}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    disabled={editBusy}
                    placeholder="What this organization is for…"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={editBusy || !editName.trim()}
                    className={primaryButtonClass}
                  >
                    Save
                  </button>
                  <StatusLine isError={editIsError}>{editStatus}</StatusLine>
                </div>
              </form>
            </section>
          )}

          {/* #133: the language members see until they pick their own. Gated
            inside on useCan("org.settings.manage"), the same PATCH gate. */}
          <OrgDefaultLanguage org={active} token={token} onSaved={() => void orgsRes.reload()} />

          {/* Members, invites and roles live in Organization › People. */}
          <section className={cardClass}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
                <Icon name="users" size={17} className="text-indigo-500 dark:text-indigo-400" />
                {t("nav.items.orgUsers.label")}
              </h2>
              <div className="flex items-center gap-4">
                {canManage && (
                  <>
                    <Link
                      to={ROUTES.people}
                      className="flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      {t("people.overview.manage")}
                      <Icon name="arrow" size={14} />
                    </Link>
                    <Link
                      to={ROUTES.peopleInvites}
                      className="flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      {t("people.overview.invite")}
                      <Icon name="arrow" size={14} />
                    </Link>
                  </>
                )}
                <Link
                  to={canManageTeams ? ROUTES.orgTeams : ROUTES.myTeam}
                  className="flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  {t("people.overview.teams")}
                  <Icon name="arrow" size={14} />
                </Link>
              </div>
            </div>
            <p className={`mt-2 ${mutedTextClass}`}>{t("people.overview.body", { org: active.name })}</p>
          </section>
        </>
      )}
    </>
  );
}
