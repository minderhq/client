import { DEFAULT_LOCALE, isLocale, LOCALES, type Locale } from "./catalog";
import { createTranslator, type Translator } from "./translator";

/**
 * The active language: one small store shared by React (useI18n) and by plain
 * modules that build user-facing text outside a component (e.g. api.ts's
 * friendlyErrorMessage).
 *
 * Detection order on load: the user's stored preference, then the browser's
 * languages (navigator.languages), then English. Once a signed-in account's
 * profile loads, its language wins (adoptProfileLocale): the account's own
 * choice, then its organization's default, then the browser, then English.
 * Signed-out pages only ever use this browser's choice.
 */

/** localStorage key of the chosen language. */
export const LOCALE_STORAGE_KEY = "minder-locale";

/** The user's saved choice, or null when they haven't picked one. Storage can
 * throw (Safari private mode, blocked storage): treat that as "no choice". */
export function readStoredLocale(): Locale | null {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** Saves the choice for this browser. A signed-in account's language lives
 * on its profile (see adoptProfileLocale / setAccountLocale); this local copy
 * is what the next page load shows until that profile has loaded. */
function writeStoredLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage unavailable: the choice still applies, it just won't survive a reload.
  }
}

/** The first supported language in the browser's preference list, matched on
 * the primary subtag ("tr-TR" and "tr" both mean Turkish). */
export function browserLocale(
  languages: readonly string[] | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator.languages?.length
      ? navigator.languages
      : [navigator.language],
): Locale | null {
  for (const tag of languages ?? []) {
    const primary = tag?.split("-")[0]?.toLowerCase();
    if (isLocale(primary)) return primary;
  }
  return null;
}

/** Saved preference → browser languages → English. */
export function detectLocale(): Locale {
  return readStoredLocale() ?? browserLocale() ?? DEFAULT_LOCALE;
}

const translators = new Map<Locale, Translator>();

/** One translator per locale, so its identity is stable across renders. */
export function translatorFor(locale: Locale): Translator {
  let translator = translators.get(locale);
  if (!translator) {
    translator = createTranslator(locale);
    translators.set(locale, translator);
  }
  return translator;
}

let current: Locale = detectLocale();
const listeners = new Set<() => void>();

function applyDocumentLang(locale: Locale): void {
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}

export function getLocale(): Locale {
  return current;
}

/** The active language's translator, for code outside React components. */
export function i18n(): Translator {
  return translatorFor(current);
}

/** Switches the UI language: saves the choice, updates `<html lang>` and
 * re-renders every component using useI18n. */
export function setLocale(locale: Locale): void {
  if (!LOCALES.includes(locale)) return;
  writeStoredLocale(locale);
  applyDocumentLang(locale);
  if (locale === current) return;
  current = locale;
  listeners.forEach((listener) => listener());
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The language-related fields of the profile (GET /v1/profile/me). */
export interface ProfileLocaleFields {
  /** The account's own choice; null when it hasn't picked one. */
  locale?: string | null;
  /** The active organization's default; null when it has none. */
  organization_default_locale?: string | null;
  /** The server's resolution of the two above. */
  effective_locale?: string | null;
}

/** The language a signed-in account sees: its own choice, then its
 * organization's default, then the browser's languages, then English. This
 * is the server's `effective_locale` plus the browser step the server can't
 * know about. Null when the profile predates these fields (an older
 * gateway): the browser's choice stays. */
export function profileLocale(profile: ProfileLocaleFields | null | undefined): Locale | null {
  if (!profile) return null;
  if (isLocale(profile.locale)) return profile.locale;
  if (isLocale(profile.organization_default_locale)) return profile.organization_default_locale;
  if (profile.locale === undefined && profile.organization_default_locale === undefined) {
    return isLocale(profile.effective_locale) ? profile.effective_locale : null;
  }
  return browserLocale() ?? DEFAULT_LOCALE;
}

/** After sign-in (and on every org switch): switch to the profile's language.
 * It outranks a choice saved in this browser, which only covers the moments
 * before the profile loads. */
export function adoptProfileLocale(profile: ProfileLocaleFields | null | undefined): void {
  const locale = profileLocale(profile);
  if (locale) setLocale(locale);
}

/** The signed-in language switch: applies `next` at once, then saves it to
 * the account with `save`. If the save fails the previous language comes
 * back (unless the user has picked another one meanwhile) and the error is
 * rethrown for the caller to show. */
export async function setAccountLocale(
  next: Locale,
  save: (locale: Locale) => Promise<unknown>,
): Promise<void> {
  const previous = current;
  setLocale(next);
  try {
    await save(next);
  } catch (err) {
    if (current === next) setLocale(previous);
    throw err;
  }
}

/** Call once at startup: puts the detected language on `<html lang>` (the
 * static index.html says "en" until this runs). */
export function initLocale(): void {
  applyDocumentLang(current);
}
