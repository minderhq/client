import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Sidebar } from "./components/Sidebar";
import { setLocale } from "./i18n";
import { CATALOGS } from "./i18n/catalog";

// The decided user-facing vocabulary (client#126): Assistant, not pipeline;
// Website chatbots, not public chat; Module, not service bundle; Tool, not AI
// tool; and in Turkish Kurum / Takım / Sohbet. Search keywords keep the old
// words on purpose, so a user typing "pipeline" still finds Assistants.
const RETIRED = {
  en: /pipeline|public chat|service bundle|\bAI tools?\b|model management|merge review/i,
  tr: /işlem hatt|kuruluş|\bekip|\bekib|herkese açık sohbet|hizmet paket|model yönetimi/i,
};

// Marketplace stays a valid concept in running copy ("a plugin you install
// from the Marketplace"), and so does billing; only menu labels and page
// titles must say Discover / Keşfet and Plan & billing / Plan ve fatura.
const RETIRED_LABELS = {
  en: /marketplace|^billing$/i,
  tr: /pazar yeri|faturalandırma/i,
};

function copyStrings(tree: unknown, out: string[] = []): string[] {
  if (typeof tree === "string") out.push(tree);
  else if (tree && typeof tree === "object") {
    for (const [key, value] of Object.entries(tree)) {
      if (key !== "keywords") copyStrings(value, out);
    }
  }
  return out;
}

vi.mock("./lib/auth", () => ({
  useAuth: () => ({ isAuthenticated: true, role: "admin", isPlatformAdmin: true }),
}));
vi.mock("./lib/useBillingAccess", () => ({ useBillingAccess: () => true }));

afterEach(() => {
  cleanup();
  setLocale("en");
});

describe("glossary", () => {
  it.each(["en", "tr"] as const)("no %s message uses a retired term", (locale) => {
    expect(copyStrings(CATALOGS[locale]).filter((s) => RETIRED[locale].test(s))).toEqual([]);
  });

  it.each(["en", "tr"] as const)("no %s menu label or page title uses a retired label", (locale) => {
    const labels = Object.values(CATALOGS[locale].nav.items).flatMap((item) => [
      item.label,
      ...("title" in item ? [item.title] : []),
    ]);
    const banned = new RegExp(`${RETIRED[locale].source}|${RETIRED_LABELS[locale].source}`, "i");
    expect(labels.filter((l) => banned.test(l))).toEqual([]);
  });

  it("keeps the old words as search keywords", () => {
    expect(CATALOGS.en.nav.items.pipelines.keywords).toContain("pipelines");
    expect(CATALOGS.tr.nav.items.pipelines.keywords).toContain("işlem hattı");
    expect(CATALOGS.tr.nav.items.discover.keywords).toContain("pazar yeri");
  });

  it("labels the Turkish menu with the decided terms", () => {
    setLocale("tr");
    render(
      <MemoryRouter>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    const labels = screen.getAllByRole("link").map((a) => a.textContent ?? "");
    for (const term of [
      "Sohbet",
      "Asistanlar",
      "Keşfet",
      "Takımım",
      "Web sitesi sohbet botları",
      "Bilgi kalitesi",
      "Plan ve fatura",
      "Yerel modeller",
      "Modüller",
    ]) {
      expect(labels).toContain(term);
    }
    for (const group of ["Kullan", "Oluştur", "Ben", "Kurum", "Platform"]) {
      expect(screen.getByRole("group", { name: group })).toBeTruthy();
    }
    expect(labels.filter((l) => RETIRED.tr.test(l) || RETIRED_LABELS.tr.test(l))).toEqual([]);
  });

  it("titles the key pages with the decided terms in both languages", () => {
    const pick = (locale: "en" | "tr") => {
      const { items } = CATALOGS[locale].nav;
      return [
        items.pipelines.label,
        items.chat.label,
        items.publicChat.label,
        items.models.label,
        items.billing.title,
        CATALOGS[locale].knowledgeQuality.entityMerges,
        CATALOGS[locale].tools.discoverTitle,
      ];
    };
    expect(pick("en")).toEqual([
      "Assistants",
      "Chat",
      "Website chatbots",
      "Local models",
      "Plan & billing",
      "Entity merges",
      "Discover tools",
    ]);
    expect(pick("tr")).toEqual([
      "Asistanlar",
      "Sohbet",
      "Web sitesi sohbet botları",
      "Yerel modeller",
      "Plan ve fatura",
      "Varlık birleştirmeleri",
      "Araçları keşfet",
    ]);
  });
});
