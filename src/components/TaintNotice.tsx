import { useState } from "react";

import { useI18n } from "../i18n";
import { formatTaint, type ToolApprovalTaint } from "../lib/taint";
import { InfoCallout } from "./InfoCallout";
import { StatusBadge } from "./StatusBadge";

/** The warnings of one pending tool call on its approval card: what untrusted
 * content it was suggested after, and the local-only data risk. Nothing for a
 * clean item. `names` maps KB ask-tool / tool names to human names. */
export function TaintNotice({
  item,
  names,
}: {
  item: ToolApprovalTaint;
  names?: Readonly<Record<string, string>>;
}) {
  const i18n = useI18n();
  const taint = formatTaint(i18n, item, names);
  const risk = item.data_policy_risk === "local_only";
  if (!taint && !risk) return null;
  return (
    <InfoCallout icon="warning">
      {taint && <p>{taint}</p>}
      {risk && <p>{i18n.t("toolApproval.localOnlyRisk")}</p>}
    </InfoCallout>
  );
}

/** The conversation's "Contains outside content" marker. Once any item or
 * turn is tainted it stays for the rest of the conversation, even when later
 * turns are clean: render it with `key={conversationId}` so a new
 * conversation starts clean. */
export function OutsideContentMarker({ tainted }: { tainted: boolean }) {
  const { t } = useI18n();
  const [seen, setSeen] = useState(tainted);
  if (tainted && !seen) setSeen(true);
  if (!seen && !tainted) return null;
  return (
    <span title={t("toolApproval.outsideContentHelp")}>
      <StatusBadge icon="warning" label={t("toolApproval.outsideContent")} tone="warn" />
      <span className="sr-only">{t("toolApproval.outsideContentHelp")}</span>
    </span>
  );
}
