import { Fragment, createElement, useSyncExternalStore, type ReactNode } from "react";

import type { MessageKey } from "./catalog";
import { getLocale, setLocale, subscribeLocale, translatorFor } from "./locale";
import type { Translator } from "./translator";

export interface I18n extends Translator {
  setLocale: typeof setLocale;
  /** A message whose placeholders are React nodes (a link, <strong>, …):
   * `rich("settings.identityNote", { portal: <a …>…</a> })`. */
  rich(key: MessageKey, nodes: Record<string, ReactNode>): ReactNode;
}

const richCache = new WeakMap<Translator, I18n>();

function withReactHelpers(translator: Translator): I18n {
  let value = richCache.get(translator);
  if (!value) {
    value = {
      ...translator,
      setLocale,
      rich(key, nodes) {
        // Split on `{name}`: odd parts are placeholder names, filled with
        // their node; an unknown name is left visible as `{name}`.
        const template = translator.t(key);
        const parts = template.split(/\{(\w+)\}/g);
        return createElement(
          Fragment,
          null,
          ...parts.map((part, i) =>
            i % 2 === 1
              ? createElement(Fragment, { key: i }, part in nodes ? nodes[part] : `{${part}}`)
              : part,
          ),
        );
      },
    };
    richCache.set(translator, value);
  }
  return value;
}

/** The active language for a component. Re-renders when the language changes
 * (setLocale). No provider needed: the locale lives in a small module store,
 * so components rendered on their own (tests, portals) get it too. */
export function useI18n(): I18n {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale);
  return withReactHelpers(translatorFor(locale));
}
