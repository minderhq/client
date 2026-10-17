/**
 * The console's i18n: typed message catalogs (messages/*.ts), a tiny locale
 * store, and Intl-based formatting. No third-party runtime: see README
 * "Translations" for why, and for how to add copy.
 */
export {
  DEFAULT_LOCALE,
  LOCALE_NAMES,
  LOCALES,
  isLocale,
  type Locale,
  type MessageKey,
  type Messages,
  type PluralMessageKey,
} from "./catalog";
export {
  browserLocale,
  detectLocale,
  getLocale,
  i18n,
  initLocale,
  LOCALE_STORAGE_KEY,
  readStoredLocale,
  setLocale,
  subscribeLocale,
} from "./locale";
export { en } from "./messages/en";
export type { Translator } from "./translator";
export { useI18n, type I18n } from "./useI18n";
