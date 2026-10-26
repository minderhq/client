import { useId } from "react";

import { useI18n } from "../i18n";
import type { ProviderTestResult } from "../lib/modelProviders";
import { StatusBadge } from "./StatusBadge";

const TONE = { yes: "success", no: "warn", unknown: "neutral" } as const;
const ICON = { yes: "check", no: "warning", unknown: "help" } as const;

/** Whether a provider's model can call tools, from its last test. Nothing
 * when there's no verdict (no test yet, a failed test, an older server).
 * "no"/"unknown" carry an explanation: shown on hover and on keyboard focus,
 * and tied to the badge with aria-describedby for screen readers. */
export function ToolSupportBadge({ tools }: { tools: ProviderTestResult["tools"] }) {
  const { t } = useI18n();
  const tipId = useId();
  if (!tools) return null;
  const badge = <StatusBadge icon={ICON[tools]} label={t(`providers.tools.${tools}`)} tone={TONE[tools]} />;
  if (tools === "yes") return badge;
  return (
    <span
      className="group relative inline-flex rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      tabIndex={0}
      aria-describedby={tipId}
    >
      {badge}
      <span
        id={tipId}
        role="tooltip"
        className="invisible absolute left-0 top-full z-10 mt-1 w-72 rounded-md bg-gray-900 p-2 text-xs text-white shadow-lg group-hover:visible group-focus:visible dark:bg-gray-700"
      >
        {t(tools === "no" ? "providers.tools.noHelp" : "providers.tools.unknownHelp")}
      </span>
    </span>
  );
}
