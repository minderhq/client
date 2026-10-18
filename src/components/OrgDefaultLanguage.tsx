import { useEffect, useId, useState } from "react";

import { isLocale, LOCALE_NAMES, LOCALES, useI18n, type Locale } from "../i18n";
import { friendlyErrorMessage } from "../lib/api";
import { type MyOrg, updateOrganization } from "../lib/orgs";
import { cardClass, fieldHintClass, inputClass } from "../lib/ui";
import { useCan } from "../lib/useCan";
import { Icon } from "./Icon";
import { StatusLine } from "./StatusLine";

/** The select's value for "no default". */
const NONE = "";

/** An organization's default UI language (#133): what members who haven't
 * picked a language in their own Settings see. Shown, and editable, only to
 * those who may manage the org's settings; the API enforces the same rule.
 * Saves on change and puts the old value back if the save fails. */
export function OrgDefaultLanguage({
  org,
  token,
  onSaved,
}: {
  org: MyOrg;
  token: string;
  /** Called after a successful save, e.g. to reload the org list. */
  onSaved?: () => void;
}) {
  const canManage = useCan("org.settings.manage");
  const { t } = useI18n();
  const selectId = useId();
  const hintId = useId();
  const saved = org.default_locale ?? null;
  const [value, setValue] = useState<Locale | null>(saved);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);

  // Follow the server's value on load, org switch and after a reload.
  useEffect(() => {
    setValue(saved);
  }, [org.id, saved]);

  if (!canManage) return null;

  async function choose(raw: string) {
    const next = isLocale(raw) ? raw : null;
    if (next === value) return;
    const previous = value;
    setValue(next);
    setBusy(true);
    setStatus(null);
    try {
      await updateOrganization(org.id, { default_locale: next }, token);
      setStatus({ text: t("organization.defaultLanguage.saved"), error: false });
      onSaved?.();
    } catch (err) {
      setValue(previous);
      setStatus({
        text: t("organization.defaultLanguage.saveFailed", { error: friendlyErrorMessage(err) }),
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`mb-4 ${cardClass}`}>
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
        <Icon name="globe" size={17} className="text-indigo-500 dark:text-indigo-400" />
        {t("organization.defaultLanguage.heading")}
      </h2>
      <label
        htmlFor={selectId}
        className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
      >
        {t("organization.defaultLanguage.label")}
      </label>
      <select
        id={selectId}
        className={inputClass}
        value={value ?? NONE}
        onChange={(e) => void choose(e.target.value)}
        disabled={busy}
        aria-describedby={hintId}
      >
        <option value={NONE}>{t("organization.defaultLanguage.none")}</option>
        {LOCALES.map((code) => (
          <option key={code} value={code} lang={code}>
            {LOCALE_NAMES[code]}
          </option>
        ))}
      </select>
      <p id={hintId} className={fieldHintClass}>
        {t("organization.defaultLanguage.hint")}
      </p>
      {status && (
        <StatusLine isError={status.error} className="mb-0 mt-2">
          {status.text}
        </StatusLine>
      )}
    </section>
  );
}
