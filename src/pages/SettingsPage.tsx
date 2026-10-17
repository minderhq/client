import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

import { isLocale, LOCALE_NAMES, LOCALES, useI18n, type MessageKey } from "../i18n";
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

const THEME_OPTIONS = [
  { value: "system", label: "theme.matchSystem" },
  { value: "light", label: "theme.light" },
  { value: "dark", label: "theme.dark" },
] as const satisfies readonly { value: Theme; label: MessageKey }[];

/** A real settings page was one of the concrete gaps in "this needs to feel
 * like a platform" -- account identity had nowhere to live before this.
 * Identity (username/email/role) still comes straight from the JWT claims and
 * is edited in Authelia's own portal, NOT duplicated here (#1504). What this
 * page DOES let you edit is Minder's own per-user state that had no edit
 * surface before: a Minder-side display name and app preferences (theme),
 * persisted server-side so they follow your account across devices. */
export function SettingsPage() {
  const { isAuthenticated, username, email, role, token, logout } = useAuth();
  const { t, rich } = useI18n();

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
      setStatus({ text: t("settings.profile.saved"), error: false });
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
        {t("settings.title")}
      </h1>
      <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
        {t("settings.intro")}
      </p>

      <section className={`mb-6 ${cardClass}`}>
        <h2 className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">
          {t("settings.account")}
        </h2>
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex items-center gap-2">
            <dt className="w-24 text-gray-500 dark:text-gray-400">{t("common.username")}</dt>
            <dd className="font-medium text-gray-900 dark:text-gray-100">
              {username}
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="w-24 text-gray-500 dark:text-gray-400">{t("common.email")}</dt>
            <dd className="text-gray-900 dark:text-gray-100">{email}</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="w-24 text-gray-500 dark:text-gray-400">{t("settings.role")}</dt>
            <dd>
              <span className={badgeClass}>{role}</span>
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
          {rich("settings.identityNote", {
            portal: autheliaPortalUrl ? (
              <a
                href={autheliaPortalUrl}
                className="underline hover:text-indigo-600 dark:hover:text-indigo-400"
              >
                {t("settings.portalLink")}
              </a>
            ) : (
              t("settings.portalPlain")
            ),
          })}
        </p>
      </section>

      <section className={`mb-6 ${cardClass}`}>
        <h2 className="mb-1 text-base font-semibold text-gray-900 dark:text-gray-100">
          {t("settings.profile.heading")}
        </h2>
        <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
          {t("settings.profile.intro")}
        </p>

        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <div>
            <label
              htmlFor="display-name"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t("settings.profile.displayName")}
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
              {t("settings.profile.displayNameHint", { username })}
            </p>
          </div>

          <div>
            <label
              htmlFor="theme-pref"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t("settings.profile.theme")}
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
                  {t(opt.label)}
                </option>
              ))}
            </select>
            <p className={fieldHintClass}>
              {t("settings.profile.themeHint")}
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
              {saving ? t("common.saving") : t("settings.profile.save")}
            </button>
          </div>
        </form>
      </section>

      <LanguageSection />

      <ChangePasswordSection token={token} />

      <button type="button" onClick={logout} className={secondaryButtonClass}>
        {t("common.logOut")}
      </button>
    </>
  );
}

/** The UI language switch. It applies at once (every component re-renders in
 * the new language) and is remembered in this browser; see i18n/locale.ts for
 * the seam where a per-user, server-side preference plugs in. */
function LanguageSection() {
  const { t, locale, setLocale } = useI18n();
  return (
    <section className={`mb-6 ${cardClass}`}>
      <h2 className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">
        {t("settings.language.heading")}
      </h2>
      <label
        htmlFor="language-pref"
        className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
      >
        {t("settings.language.label")}
      </label>
      <select
        id="language-pref"
        value={locale}
        onChange={(e) => {
          if (isLocale(e.target.value)) setLocale(e.target.value);
        }}
        aria-describedby="language-pref-hint"
        className={inputClass}
      >
        {LOCALES.map((code) => (
          <option key={code} value={code} lang={code}>
            {LOCALE_NAMES[code]}
          </option>
        ))}
      </select>
      <p id="language-pref-hint" className={fieldHintClass}>
        {t("settings.language.hint")}
      </p>
    </section>
  );
}

/** Change the caller's own LOCAL password. SSO-linked
 * accounts are refused by the gateway with a 409 whose message points at the
 * Authelia portal — surfaced as-is, since the client can't tell the two
 * account kinds apart from the JWT alone. */
export function ChangePasswordSection({
  token,
  onChanged,
}: {
  token: string;
  /** Called after a successful change (the forced-change flow, #1776). */
  onChanged?: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const { t, plural } = useI18n();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    if (next.length < MIN_PASSWORD_LENGTH) {
      setStatus({
        text: plural("settings.password.tooShort", MIN_PASSWORD_LENGTH),
        error: true,
      });
      return;
    }
    if (next !== confirm) {
      setStatus({ text: t("settings.password.mismatch"), error: true });
      return;
    }
    if (next === current) {
      setStatus({ text: t("settings.password.unchanged"), error: true });
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next, token);
      setCurrent("");
      setNext("");
      setConfirm("");
      setStatus({ text: t("settings.password.changed"), error: false });
      onChanged?.();
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
        {t("settings.password.heading")}
      </h2>
      <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
        {t("settings.password.intro")}
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label
            htmlFor="current-password"
            className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            {t("settings.password.current")}
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
            {t("settings.password.new")}
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
            {plural("settings.password.minHint", MIN_PASSWORD_LENGTH)}
          </p>
        </div>
        <div>
          <label
            htmlFor="confirm-password"
            className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            {t("settings.password.confirm")}
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
            {busy ? t("settings.password.changing") : t("settings.password.submit")}
          </button>
        </div>
      </form>
    </section>
  );
}
