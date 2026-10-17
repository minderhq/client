import { en } from "./messages/en";
import { tr } from "./messages/tr";
import type { PluralKey, TextKey, Widen } from "./types";

/** The catalog shape every language must fill (English's, widened). */
export type Messages = Widen<typeof en>;

/** A key of a plain message, e.g. `"common.retry"`. */
export type MessageKey = TextKey<Messages>;

/** A key of a plural message, e.g. `"common.results"`. */
export type PluralMessageKey = PluralKey<Messages>;

/** The languages the console ships. English is the fallback. */
export const LOCALES = ["en", "tr"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Each language's name in that language (an autonym, so a user who can't
 * read the current UI language still finds their own in the switcher). */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  tr: "Türkçe",
};

/** Both catalogs are bundled: together they are a few kB gzipped, so lazy
 * loading would cost a loading state on every first paint for no real gain.
 * Revisit if many more languages are added. */
export const CATALOGS: Record<Locale, Messages> = { en, tr };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
