import { useId, useState } from "react";

import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { InfoCallout } from "../components/InfoCallout";
import { PageHeader } from "../components/PageHeader";
import { StatusLine } from "../components/StatusLine";
import { friendlyErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { filterByText } from "../lib/filterByText";
import {
  createOrganization,
  type DirectoryUser,
  fetchAllOrganizations,
  fetchAllUsers,
  type OrgListItem,
  slugify,
} from "../lib/orgs";
import {
  badgeClass,
  cardClass,
  fieldHintClass,
  inputClass,
  mutedTextClass,
  primaryButtonClass,
} from "../lib/ui";
import { useAsyncResource } from "../lib/useAsyncResource";

/** Platform-operator (admin) view of EVERY organization on the instance, and
 * where new tenants are provisioned. Distinct from the Organization page, which
 * is the current user's own org. Both org create and the all-orgs list are
 * admin-only endpoints, so the whole page is gated to instance admins. */
export function AllOrganizationsPage() {
  const { isAuthenticated, token, role } = useAuth();
  const isAdmin = role === "admin";
  const nameId = useId();
  const slugId = useId();
  const ownerId = useId();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [owner, setOwner] = useState("");
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [filter, setFilter] = useState("");

  const orgsRes = useAsyncResource<OrgListItem[]>(
    (signal) => fetchAllOrganizations(token, signal).then((r) => r.organizations),
    { deps: [token], enabled: isAuthenticated && isAdmin },
  );
  const usersRes = useAsyncResource<DirectoryUser[]>(
    (signal) => fetchAllUsers(token, signal).then((r) => r.users),
    { deps: [token], enabled: isAuthenticated && isAdmin },
  );

  function onNameChange(v: string) {
    setName(v);
    if (!slugTouched) setSlug(slugify(v));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    if (!name.trim() || !slug.trim()) {
      setStatus("Name and slug are required.");
      setIsError(true);
      return;
    }
    setCreating(true);
    setStatus("Creating…");
    setIsError(false);
    try {
      await createOrganization(
        { name: name.trim(), slug: slug.trim(), owner_user_id: owner ? Number(owner) : undefined },
        token,
      );
      setName("");
      setSlug("");
      setSlugTouched(false);
      setOwner("");
      setStatus("Organization created.");
      await orgsRes.reload();
    } catch (err) {
      setStatus(friendlyErrorMessage(err));
      setIsError(true);
    } finally {
      setCreating(false);
    }
  }

  if (!isAuthenticated || !isAdmin) {
    return (
      <>
        <PageHeader
          icon="org"
          title="All Organizations"
          subtitle="Every organization on this instance, and provisioning new ones."
        />
        <InfoCallout icon="lock">
          Admins only — log in with an admin account to manage organizations.
        </InfoCallout>
      </>
    );
  }

  const orgs = orgsRes.data ?? [];
  const visible = filterByText(orgs, filter, (o) => [o.name, o.slug]);

  return (
    <>
      <PageHeader
        icon="org"
        title="All Organizations"
        subtitle="Every organization (tenant) on this instance. Provision a new one below — it gets a primary owner and a default team automatically."
      />

      {/* Create. */}
      <form onSubmit={handleCreate} className={`mb-6 ${cardClass}`}>
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
          <Icon name="plus" size={16} className="text-indigo-500 dark:text-indigo-400" />
          Create an organization
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={nameId} className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Name
            </label>
            <input
              id={nameId}
              className={inputClass}
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              disabled={creating}
              placeholder="Acme Corporation"
            />
          </div>
          <div>
            <label htmlFor={slugId} className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Slug
            </label>
            <input
              id={slugId}
              className={inputClass}
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugTouched(true);
              }}
              disabled={creating}
              placeholder="acme"
            />
            <p className={fieldHintClass}>
              URL-safe handle (letters, numbers, <code>. _ -</code>). Also used for
              SSO domain mapping.
            </p>
          </div>
          <div>
            <label htmlFor={ownerId} className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Primary owner
            </label>
            <select
              id={ownerId}
              className={inputClass}
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              disabled={creating}
            >
              <option value="">You (the creator)</option>
              {(usersRes.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username} ({u.email})
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button type="submit" disabled={creating} className={primaryButtonClass}>
            <Icon name={creating ? "reset" : "plus"} size={16} className={creating ? "animate-spin" : undefined} />
            Create organization
          </button>
          <StatusLine isError={isError} className="!mb-0">
            {status}
          </StatusLine>
        </div>
      </form>

      {/* List. */}
      <StatusLine isError={!!orgsRes.error}>
        {orgsRes.error ?? (orgsRes.loading && !orgsRes.data ? "Loading…" : "")}
      </StatusLine>

      {orgs.length > 5 && (
        <input
          className={`${inputClass} mb-3 max-w-xs`}
          type="text"
          placeholder="Filter by name or slug…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter organizations"
        />
      )}

      {orgsRes.data && orgs.length === 0 ? (
        <EmptyState>No organizations yet — create the first one above.</EmptyState>
      ) : (
        visible.map((org) => (
          <section key={org.id} className={`mb-3 ${cardClass} !py-3`}>
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                <Icon name="org" size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {org.name}
                </h3>
                <p className={`truncate text-xs ${mutedTextClass}`}>
                  <code>{org.slug}</code>
                  {org.created_at && ` · created ${org.created_at.slice(0, 10)}`}
                </p>
              </div>
              <span className={badgeClass}>
                <Icon name="users" size={13} />
                {org.member_count} member{org.member_count === 1 ? "" : "s"}
              </span>
            </div>
          </section>
        ))
      )}
      {orgs.length > 0 && visible.length === 0 && (
        <EmptyState>No organizations match "{filter}".</EmptyState>
      )}
    </>
  );
}
