import type { MessageKey, Translator } from "../i18n";

/** The taint fields of one `pending_tool_call.items[]` entry (chat 200,
 * headless 202, `GET /v1/ai/chat/approvals/{id}`). */
export interface ToolApprovalTaint {
  /** Untrusted content entered the context before this call was suggested. */
  tainted: boolean;
  /** Where it came from: `kb:<ask tool>`, `tool:<name>`, `history`,
   * `unverified_history`, `visitor`, `external_caller`. */
  taint_sources: string[];
  /** Held because its plugin may send data out after local-only data was read. */
  data_policy_risk?: "local_only" | null;
}

const FIXED_SOURCES: Record<string, MessageKey> = {
  history: "toolApproval.source.history",
  unverified_history: "toolApproval.source.unverifiedHistory",
  visitor: "toolApproval.source.visitor",
  external_caller: "toolApproval.source.externalCaller",
};

/** One taint source id as a phrase. `names` maps a KB ask-tool or tool name
 * to its human name (from the KB / plugin lists); the raw name otherwise. */
export function describeTaintSource(
  { t }: Pick<Translator, "t">,
  source: string,
  names: Readonly<Record<string, string>> = {},
): string {
  const [kind, ...rest] = source.split(":");
  const name = rest.join(":");
  if (name && (kind === "kb" || kind === "tool")) {
    return t(`toolApproval.source.${kind}`, { name: names[name] || name });
  }
  return t(FIXED_SOURCES[source] ?? "toolApproval.source.other");
}

/** "Suggested after reading X, Y and Z." for a tainted item; null otherwise. */
export function formatTaint(
  i18n: Pick<Translator, "t" | "locale">,
  item: ToolApprovalTaint,
  names?: Readonly<Record<string, string>>,
): string | null {
  if (!item.tainted) return null;
  // Tainted with no recorded source still warns, with the generic phrase.
  const phrases = [...new Set((item.taint_sources.length ? item.taint_sources : [""]).map((s) => describeTaintSource(i18n, s, names)))];
  const sources = new Intl.ListFormat(i18n.locale, { type: "conjunction" }).format(phrases);
  return i18n.t("toolApproval.taintedAfter", { sources });
}
