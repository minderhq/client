// @vitest-environment node
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// The i18n lint rule (eslint.config.js, I18N_MIGRATED_FILES): hard-coded copy
// fails in a migrated file and is left alone, for now, in a legacy one.
const eslint = new ESLint();

async function hardcodedTextErrors(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages
    .filter((m) => m.ruleId === "no-restricted-syntax" && m.message.startsWith("Hard-coded"))
    .map((m) => code.split("\n")[m.line - 1].trim());
}

const SAMPLE = `
import { useI18n } from "../i18n";
export function Sample({ busy }: { busy: boolean }) {
  const { t } = useI18n();
  return (
    <div className={busy ? "opacity-50 text-sm" : "text-sm"} data-state="idle">
      <h1>Hello there</h1>
      <p>{"Plain string child"}</p>
      <p>{busy ? "Working" : t("common.loading")}</p>
      <input placeholder="Type here" aria-label={\`Search \${t("common.or")}\`} />
      <span>Minder</span>
      <span>{t("common.retry")} K</span>
    </div>
  );
}
`;

describe("hard-coded user-facing strings", () => {
  it("are flagged in a migrated file", async () => {
    expect(await hardcodedTextErrors(SAMPLE, "src/components/Sidebar.tsx")).toEqual([
      "<h1>Hello there</h1>",
      '<p>{"Plain string child"}</p>',
      '<p>{busy ? "Working" : t("common.loading")}</p>',
      '<input placeholder="Type here" aria-label={`Search ${t("common.or")}`} />',
      '<input placeholder="Type here" aria-label={`Search ${t("common.or")}`} />',
    ]);
  }, 30_000);

  it("are not flagged (yet) in a file that hasn't been migrated", async () => {
    expect(await hardcodedTextErrors(SAMPLE, "src/pages/HomePage.tsx")).toEqual([]);
  }, 30_000);
});
