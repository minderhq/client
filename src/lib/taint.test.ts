import { describe, expect, it } from "vitest";

import { createTranslator } from "../i18n/translator";
import { formatTaint } from "./taint";

const en = createTranslator("en");
const tr = createTranslator("tr");
const names = { ask_contracts: "Sözleşmeler", get_ticket: "Get ticket" };

describe("formatTaint", () => {
  it("is null for a clean item", () => {
    expect(formatTaint(tr, { tainted: false, taint_sources: [] })).toBeNull();
  });

  it("names a KB source by its human name, in Turkish", () => {
    expect(formatTaint(tr, { tainted: true, taint_sources: ["kb:ask_contracts"] }, names)).toBe(
      "Bu istek, “Sözleşmeler” bilgi tabanından gelen bir metinden sonra geldi.",
    );
  });

  it("lists every source, falls back to the raw tool name, and drops duplicates", () => {
    expect(
      formatTaint(en, {
        tainted: true,
        taint_sources: ["tool:send_mail", "history", "visitor", "external_caller", "unverified_history", "history"],
      }),
    ).toBe(
      "Suggested after reading the output of the “send_mail” tool, tool output from earlier in this conversation, a website visitor's message, a request from an outside caller, and earlier messages that couldn't be verified.",
    );
  });

  it("still warns for an unknown or missing source", () => {
    expect(formatTaint(en, { tainted: true, taint_sources: ["something_new"] })).toBe(
      "Suggested after reading content from an outside source.",
    );
    expect(formatTaint(tr, { tainted: true, taint_sources: [] })).toBe(
      "Bu istek, dış bir kaynaktan gelen içerikten sonra geldi.",
    );
  });

  it("joins Turkish sources with ve", () => {
    expect(formatTaint(tr, { tainted: true, taint_sources: ["tool:get_ticket", "visitor"] }, names)).toBe(
      "Bu istek, “Get ticket” aracının çıktısından ve bir site ziyaretçisinin mesajından sonra geldi.",
    );
  });
});
