import {
  CATALOGS,
  DEFAULT_LOCALE,
  type Locale,
  type MessageKey,
  type Messages,
  type PluralMessageKey,
} from "./catalog";
import type { MessageParams, PluralForms } from "./types";

/** Everything a component needs to speak the active language. */
export interface Translator {
  locale: Locale;
  messages: Messages;
  /** A plain message, with `{name}` placeholders filled from `params`. */
  t(key: MessageKey, params?: MessageParams): string;
  /** A plural message: the form for `count` in this locale (`=0` first, then
   * the CLDR category), with `{count}` and any other placeholders filled. */
  plural(key: PluralMessageKey, count: number, params?: MessageParams): string;
  /** `Intl.NumberFormat` in this locale. */
  formatNumber(value: number, options?: Intl.NumberFormatOptions): string;
  /** `Intl.DateTimeFormat` in this locale. Accepts a Date, epoch ms or an
   * ISO string; an unparseable value is returned as given. */
  formatDate(value: Date | number | string, options?: Intl.DateTimeFormatOptions): string;
}

function lookup(messages: Messages, key: string): unknown {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

function warnMissing(locale: Locale, key: string): void {
  if (import.meta.env.DEV) console.warn(`[i18n] missing message "${key}" (${locale})`);
}

/** Builds a translator for one locale. Keys are type-checked, so a missing
 * key can only come from a cast: it falls back to English, then to the key
 * itself, so the UI shows something instead of crashing. */
export function createTranslator(locale: Locale): Translator {
  const messages = CATALOGS[locale];
  const numberFormat = new Intl.NumberFormat(locale);
  const pluralRules = new Intl.PluralRules(locale);

  function interpolate(template: string, params?: MessageParams): string {
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) => {
      const value = params[name];
      if (value === undefined) return match;
      return typeof value === "number" ? numberFormat.format(value) : value;
    });
  }

  function resolve(key: string): unknown {
    const value = lookup(messages, key);
    if (value !== undefined || locale === DEFAULT_LOCALE) return value;
    return lookup(CATALOGS[DEFAULT_LOCALE], key);
  }

  return {
    locale,
    messages,
    t(key, params) {
      const value = resolve(key);
      if (typeof value !== "string") {
        warnMissing(locale, key);
        return key;
      }
      return interpolate(value, params);
    },
    plural(key, count, params) {
      const forms = resolve(key) as PluralForms | undefined;
      if (!forms || typeof forms.other !== "string") {
        warnMissing(locale, key);
        return key;
      }
      const exact = count === 0 ? forms["=0"] : undefined;
      const template = exact ?? forms[pluralRules.select(count)] ?? forms.other;
      return interpolate(template, { ...params, count });
    },
    formatNumber(value, options) {
      return options
        ? new Intl.NumberFormat(locale, options).format(value)
        : numberFormat.format(value);
    },
    formatDate(value, options) {
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return new Intl.DateTimeFormat(locale, options).format(date);
    },
  };
}
