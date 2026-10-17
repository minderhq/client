import { DEFAULT_LOCALE, isLocale, LOCALES, type Locale } from "./catalog";
import { createTranslator, type Translator } from "./translator";

/**
 * The active language: one small store shared by React (useI18n) and by plain
 * modules that build user-facing text outside a component (e.g. api.ts's
 * friendlyErrorMessage).
 *
 * Detection order on load: the user's stored preference, then the browser's
 * languages (navigator.languages), then English.
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

/** Saves the choice for this browser.
 *
 * TODO(per-user preference): the language should follow the account across
 * devices. Once the API serves a per-user language preference, read it after
 * sign-in (it outranks this browser's stored value and the browser language)
 * and write it from the Settings language switch next to this local copy. This
 * function and readStoredLocale are the seam: callers don't need to change. */
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

/** Call once at startup: puts the detected language on `<html lang>` (the
 * static index.html says "en" until this runs). */
export function initLocale(): void {
  applyDocumentLang(current);
}
