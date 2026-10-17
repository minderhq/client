/**
 * Types for the message catalogs.
 *
 * The English catalog (messages/en.ts) is the source of truth for the SHAPE.
 * Every other catalog is typed as `Messages`, so a key missing from it (or one
 * it has that English doesn't) fails `tsc`. Keys passed to `t()` are checked
 * against the same shape, so a typo or a removed key fails `tsc` too.
 */

/** CLDR plural forms, chosen with `Intl.PluralRules` for the active locale.
 * `other` is required in every language. `"=0"` is an exact match checked
 * first (ICU's `=0`), for copy like "No results" instead of "0 results".
 * English and Turkish only use `one` and `other`; the rest exist so a later
 * language with more categories fits the same type. */
export interface PluralForms {
  "=0"?: string;
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

/** A catalog subtree: a message, a plural message, or a namespace of more. */
export interface MessageTree {
  [key: string]: string | PluralForms | MessageTree;
}

/** The catalog shape with literal strings widened to `string`, so another
 * language can fill it with its own copy. */
export type Widen<T> = T extends string
  ? string
  : T extends { other: string }
    ? PluralForms
    : { [K in keyof T]: Widen<T[K]> };

/** Dotted paths to plain messages, e.g. `"common.retry"`. */
export type TextKey<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends { other: string }
      ? never
      : `${K}.${TextKey<T[K]>}`;
}[keyof T & string];

/** Dotted paths to plural messages, e.g. `"common.results"`. */
export type PluralKey<T> = {
  [K in keyof T & string]: T[K] extends string
    ? never
    : T[K] extends { other: string }
      ? K
      : `${K}.${PluralKey<T[K]>}`;
}[keyof T & string];

/** Values for `{name}` placeholders. Numbers are formatted for the locale. */
export type MessageParams = Record<string, string | number>;
