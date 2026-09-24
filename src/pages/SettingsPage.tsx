import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

import { autheliaPortalUrl } from "../lib/api";
import { useAuth } from "../lib/auth";
import { changePassword, MIN_PASSWORD_LENGTH } from "../lib/password";
import { fetchMyProfile, updateMyProfile } from "../lib/profile";
import { getTheme, setTheme, type Theme } from "../lib/theme";
import {
  badgeClass,
  cardClass,
  fieldHintClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  statusClass,
} from "../lib/ui";
import { useAsyncResource } from "../lib/useAsyncResource";

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "system", label: "Match system" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** A real settings page was one of the concrete gaps in "this needs to feel
 * like a platform" -- account identity had nowhere to live before this.
 * Identity (username/email/role) still comes straight from the JWT claims and
 * is edited in Authelia's own portal, NOT duplicated here (#1504). What this
 * page DOES let you edit is Minder's own per-user state that had no edit
 * surface before: a Minder-side display name and app preferences (theme),
 * persisted server-side so they follow your account across devices. */
export function SettingsPage() {
  const { isAuthenticated, username, email, role, token, logout } = useAuth();

  const profile = useAsyncResource((signal) => fetchMyProfile(token, signal), {
    enabled: isAuthenticated && !!token,
  });

  const [displayName, setDisplayName] = useState("");
  // Theme defaults to whatever this browser currently applies until the server
  // profile loads; the effect below adopts the persisted value once available.
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(
    null,
  );

  // Hydrate the form from the loaded profile exactly once per load.
  useEffect(() => {
    if (!profile.data) return;
    setDisplayName(profile.data.display_name ?? "");
    const savedTheme = profile.data.preferences?.theme;
    if (savedTheme === "light" || savedTheme === "dark" || savedTheme === "system") {
      setThemeState(savedTheme);
    }
  }, [profile.data]);

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      const trimmed = displayName.trim();
      await updateMyProfile(
        {
          display_name: trimmed === "" ? null : trimmed,
          preferences: { ...(profile.data?.preferences ?? {}), theme },
        },
        token,
      );
      // Apply the theme locally too, so the choice takes effect immediately
      // (and index.html's anti-flash script picks it up on the next load).
      setTheme(theme);
      setStatus({ text: "Profile saved.", error: false });
      profile.reload();
    } catch (err) {
      setStatus({
        text: err instanceof Error ? err.message : String(err),
        error: true,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <h1 className="mb-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
        Settings
      </h1>
      <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
        Your account, as Minder currently sees it.
      </p>

      <section className={`mb-6 ${cardClass}`}>
        <h2 className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">
          Account
        </h2>
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex items-center gap-2">
            <dt className="w-24 text-gray-500 dark:text-gray-400">Username</dt>
            <dd className="font-medium text-gray-900 dark:text-gray-100">
              {username}
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="w-24 text-gray-500 dark:text-gray-400">Email</dt>
            <dd className="text-gray-900 dark:text-gray-100">{email}</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="w-24 text-gray-500 dark:text-gray-400">Role</dt>
            <dd>
              <span className={badgeClass}>{role}</span>
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
          Signed in via Authelia SSO or a local Minder account. A local account
          can change its password below; for an SSO account, change your
          password or group membership in{" "}
          {autheliaPortalUrl ? (
            <a
              href={autheliaPortalUrl}
              className="underline hover:text-indigo-600 dark:hover:text-indigo-400"
            >
              Authelia's own portal
            </a>
          ) : (
            "your identity provider's portal (Authelia)"
          )}{" "}
          — that's the actual identity source for SSO logins, not this page.
        </p>
      </section>

      <section className={`mb-6 ${cardClass}`}>
        <h2 className="mb-1 text-base font-semibold text-gray-900 dark:text-gray-100">
          Minder profile
        </h2>
        <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
          Minder's own per-user preferences — separate from your Authelia
          identity above. These are saved to your account, so they follow you
          across devices.
        </p>

        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <div>
            <label
              htmlFor="display-name"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Display name
            </label>
            <input
              id="display-name"
              type="text"
              maxLength={100}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={username}
              disabled={saving || profile.loading}
              className={inputClass}
            />
            <p className={fieldHintClass}>
              How Minder addresses you in its own UI. Leave blank to use your
              username ({username}). This does not change your Authelia identity.
            </p>
          </div>

          <div>
            <label
              htmlFor="theme-pref"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Theme
            </label>
            <select
              id="theme-pref"
              value={theme}
              onChange={(e) => setThemeState(e.target.value as Theme)}
              disabled={saving || profile.loading}
              className={inputClass}
            >
              {THEME_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className={fieldHintClass}>
              Applied immediately and remembered on your account.
            </p>
          </div>

          {status && (
            <p className={statusClass(status.error)}>{status.text}</p>
          )}
          {profile.error && !status && (
            <p className={statusClass(true)}>{profile.error}</p>
          )}

          <div>
            <button
              type="submit"
              disabled={saving || profile.loading}
              className={primaryButtonClass}
            >
              {saving ? "Saving…" : "Save profile"}
            </button>
          </div>
        </form>
      </section>

      <ChangePasswordSection token={token} />

      <button type="button" onClick={logout} className={secondaryButtonClass}>
        Log out
      </button>
    </>
  );
}

/** Change the caller's own LOCAL password (minderhq/minder#1776). SSO-linked
 * accounts are refused by the gateway with a 409 whose message points at the
 * Authelia portal — surfaced as-is, since the client can't tell the two
 * account kinds apart from the JWT alone. */
function ChangePasswordSection({ token }: { token: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(
    null,
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    if (next.length < MIN_PASSWORD_LENGTH) {
      setStatus({
        text: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
        error: true,
      });
      return;
    }
    if (next !== confirm) {
      setStatus({ text: "New passwords don't match.", error: true });
      return;
    }
    if (next === current) {
      setStatus({
        text: "New password must differ from the current password.",
        error: true,
      });
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next, token);
      setCurrent("");
      setNext("");
      setConfirm("");
      setStatus({ text: "Password changed.", error: false });
    } catch (err) {
      setStatus({
        text: err instanceof Error ? err.message : String(err),
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`mb-6 ${cardClass}`}>
      <h2 className="mb-1 text-base font-semibold text-gray-900 dark:text-gray-100">
        Change password
      </h2>
      <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
        For local Minder accounts. Accounts that sign in via Authelia SSO change
        their password in the Authelia portal instead.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label
            htmlFor="current-password"
            className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Current password
          </label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            disabled={busy}
            className={inputClass}
          />
        </div>
        <div>
          <label
            htmlFor="new-password"
            className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            New password
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            disabled={busy}
            className={inputClass}
          />
          <p className={fieldHintClass}>
            At least {MIN_PASSWORD_LENGTH} characters.
          </p>
        </div>
        <div>
          <label
            htmlFor="confirm-password"
            className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Confirm new password
          </label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={busy}
            className={inputClass}
          />
        </div>

        {status && <p className={statusClass(status.error)}>{status.text}</p>}

        <div>
          <button type="submit" disabled={busy} className={primaryButtonClass}>
            {busy ? "Changing…" : "Change password"}
          </button>
        </div>
      </form>
    </section>
  );
}
