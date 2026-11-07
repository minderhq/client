import { useEffect, useId, useState } from "react";

import { useI18n } from "../i18n";
import { friendlyErrorMessage } from "../lib/api";
import { type ChatHistoryRetentionDays, type MyOrg, updateOrganization } from "../lib/orgs";
import { cardClass, fieldHintClass, inputClass } from "../lib/ui";
import { useCan } from "../lib/useCan";
import { Icon } from "./Icon";
import { StatusLine } from "./StatusLine";

/** The select's value for "keep forever" (the API's null). */
const FOREVER = "";
const CHOICES: ChatHistoryRetentionDays[] = [30, 90, 365];
/** The server's default when the org has never set one. */
const DEFAULT_DAYS: ChatHistoryRetentionDays = 365;

function parse(raw: string): ChatHistoryRetentionDays | null {
  const n = Number(raw);
  return CHOICES.includes(n as ChatHistoryRetentionDays) ? (n as ChatHistoryRetentionDays) : null;
}

/** How long the org's signed-in chat history is kept (#172). Same shape and
 * gate as OrgDefaultLanguage: org.settings.manage, saved on change, the old
 * value restored if the save fails. */
export function OrgChatRetention({
  org,
  token,
  onSaved,
}: {
  org: MyOrg;
  token: string;
  onSaved?: () => void;
}) {
  const canManage = useCan("org.settings.manage");
  const { t } = useI18n();
  const selectId = useId();
  const hintId = useId();
  // Absent (an older gateway) reads as the server default; null is "forever".
  const saved =
    org.chat_history_retention_days === undefined ? DEFAULT_DAYS : org.chat_history_retention_days;
  const [value, setValue] = useState<ChatHistoryRetentionDays | null>(saved);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    setValue(saved);
  }, [org.id, saved]);

  if (!canManage) return null;

  async function choose(raw: string) {
    const next = parse(raw);
    if (next === value) return;
    const previous = value;
    setValue(next);
    setBusy(true);
    setStatus(null);
    try {
      await updateOrganization(org.id, { chat_history_retention_days: next }, token);
      setStatus({ text: t("organization.chatRetention.saved"), error: false });
      onSaved?.();
    } catch (err) {
      setValue(previous);
      setStatus({
        text: t("organization.chatRetention.saveFailed", { error: friendlyErrorMessage(err) }),
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`mb-4 ${cardClass}`}>
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
        <Icon name="conversations" size={17} className="text-indigo-500 dark:text-indigo-400" />
        {t("organization.chatRetention.heading")}
      </h2>
      <label
        htmlFor={selectId}
        className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
      >
        {t("organization.chatRetention.label")}
      </label>
      <select
        id={selectId}
        className={inputClass}
        value={value === null ? FOREVER : String(value)}
        onChange={(e) => void choose(e.target.value)}
        disabled={busy}
        aria-describedby={hintId}
      >
        <option value="30">{t("organization.chatRetention.days30")}</option>
        <option value="90">{t("organization.chatRetention.days90")}</option>
        <option value="365">{t("organization.chatRetention.days365")}</option>
        <option value={FOREVER}>{t("organization.chatRetention.forever")}</option>
      </select>
      <p id={hintId} className={fieldHintClass}>
        {t("organization.chatRetention.hint")}
      </p>
      {status && (
        <StatusLine isError={status.error} className="mb-0 mt-2">
          {status.text}
        </StatusLine>
      )}
    </section>
  );
}
