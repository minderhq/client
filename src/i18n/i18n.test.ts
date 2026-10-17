import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CATALOGS, type Messages } from "./catalog";
import {
  browserLocale,
  detectLocale,
  getLocale,
  i18n,
  LOCALE_STORAGE_KEY,
  readStoredLocale,
  setLocale,
} from "./locale";
import { createTranslator } from "./translator";

const en = createTranslator("en");
const tr = createTranslator("tr");

// jsdom under some Node versions has no working `localStorage` global (see
// lib/theme.test.ts): use a Map-backed stand-in.
function stubLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  });
}

beforeEach(stubLocalStorage);

afterEach(() => {
  setLocale("en");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("interpolation", () => {
  it("fills {name} placeholders in each language", () => {
    expect(en.t("palette.goTo", { group: "Knowledge" })).toBe("Go to Knowledge");
    expect(tr.t("palette.goTo", { group: "Bilgi" })).toBe("Bilgi bölümüne git");
  });

  it("formats numeric params for the locale", () => {
    expect(en.t("auth.reset.tooLong", { max: 1234 })).toContain("1,234 bytes");
    expect(tr.t("auth.reset.tooLong", { max: 1234 })).toContain("1.234 baytın");
  });

  it("leaves an unknown placeholder visible instead of dropping it", () => {
    expect(en.t("palette.goTo")).toBe("Go to {group}");
  });
});

describe("plurals", () => {
  it("picks the CLDR form for the count, with =0 first", () => {
    expect(en.plural("common.results", 0)).toBe("No results");
    expect(en.plural("common.results", 1)).toBe("1 result");
    expect(en.plural("common.results", 2)).toBe("2 results");
    expect(en.plural("common.results", 1500)).toBe("1,500 results");
  });

  it("uses Turkish rules (no plural noun after a number)", () => {
    expect(tr.plural("common.results", 0)).toBe("Sonuç yok");
    expect(tr.plural("common.results", 1)).toBe("1 sonuç");
    expect(tr.plural("common.results", 1500)).toBe("1.500 sonuç");
  });

  it("fills other placeholders alongside {count}", () => {
    expect(en.plural("settings.password.tooShort", 1)).toBe(
      "New password must be at least 1 character.",
    );
    expect(en.plural("settings.password.tooShort", 8)).toBe(
      "New password must be at least 8 characters.",
    );
  });
});

describe("Intl formatting", () => {
  const date = new Date(Date.UTC(2026, 0, 15, 12));

  it("formats dates in the active locale", () => {
    const opts: Intl.DateTimeFormatOptions = { month: "long", timeZone: "UTC" };
    expect(en.formatDate(date, opts)).toBe("January");
    expect(tr.formatDate(date, opts)).toBe("Ocak");
    expect(tr.formatDate(date.toISOString(), opts)).toBe("Ocak");
  });

  it("returns an unparseable date as given", () => {
    expect(en.formatDate("not a date")).toBe("not a date");
  });

  it("formats numbers in the active locale", () => {
    expect(en.formatNumber(1234.5)).toBe("1,234.5");
    expect(tr.formatNumber(1234.5)).toBe("1.234,5");
    expect(tr.formatNumber(0.25, { style: "percent" })).toBe("%25");
  });
});

describe("missing keys", () => {
  it("are rejected by the type checker", () => {
    // tsc -b checks these lines: each must be an error, or the build fails
    // ("unused @ts-expect-error").
    // @ts-expect-error -- not a key
    en.t("common.doesNotExist");
    // @ts-expect-error -- a namespace, not a message
    en.t("common");
    // @ts-expect-error -- a plural message needs plural()
    en.t("common.results");
    // @ts-expect-error -- a plain message is not plural
    en.plural("common.retry", 2);
  });

  it("fall back to the key at runtime (only reachable through a cast)", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const key = "common.doesNotExist" as Parameters<typeof en.t>[0];
    expect(en.t(key)).toBe("common.doesNotExist");
  });
});

/** Every key path of a catalog, with its placeholders (plural forms merged). */
function shape(tree: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
    if (typeof value === "string") {
      out.set(path, `text ${placeholders(value).join(",")}`);
    } else if (value && typeof value === "object" && "other" in value) {
      const all = new Set(Object.values(value as Record<string, string>).flatMap(placeholders));
      out.set(path, `plural ${[...all].sort().join(",")}`);
    } else {
      for (const [k, v] of shape(value, path)) out.set(k, v);
    }
  }
  return out;
}

describe("catalogs", () => {
  const reference = shape(CATALOGS.en);

  it.each(Object.keys(CATALOGS) as (keyof typeof CATALOGS)[])(
    "%s has exactly English's keys, kinds and placeholders",
    (locale) => {
      expect(Object.fromEntries(shape(CATALOGS[locale]))).toEqual(
        Object.fromEntries(reference),
      );
    },
  );

  it("has no empty messages", () => {
    for (const [locale, messages] of Object.entries(CATALOGS) as [string, Messages][]) {
      const walk = (node: unknown, path: string) => {
        if (typeof node === "string") {
          expect(node.trim(), `${locale}:${path}`).not.toBe("");
          return;
        }
        for (const [k, v] of Object.entries(node as object)) walk(v, `${path}.${k}`);
      };
      walk(messages, locale);
    }
  });
});

describe("language detection", () => {
  it("matches the browser's languages on the primary subtag, in order", () => {
    expect(browserLocale(["tr-TR", "en-US"])).toBe("tr");
    expect(browserLocale(["de-DE", "en-GB", "tr"])).toBe("en");
    expect(browserLocale(["de-DE", "fr"])).toBeNull();
    expect(browserLocale([])).toBeNull();
  });

  it("prefers the saved choice, then the browser, then English", () => {
    const languages = vi.spyOn(navigator, "languages", "get");

    languages.mockReturnValue(["tr-TR"]);
    expect(detectLocale()).toBe("tr");

    localStorage.setItem(LOCALE_STORAGE_KEY, "en");
    expect(detectLocale()).toBe("en");

    localStorage.clear();
    languages.mockReturnValue(["de-DE", "fr-FR"]);
    expect(detectLocale()).toBe("en");
  });

  it("ignores a stored value that isn't a supported language", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "klingon");
    expect(readStoredLocale()).toBeNull();
  });
});

describe("setLocale", () => {
  it("switches the active language, saves it and sets <html lang>", () => {
    setLocale("tr");
    expect(getLocale()).toBe("tr");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("tr");
    expect(document.documentElement.lang).toBe("tr");
    expect(i18n().t("common.retry")).toBe("Yeniden dene");

    setLocale("en");
    expect(document.documentElement.lang).toBe("en");
    expect(i18n().t("common.retry")).toBe("Retry");
  });
});
