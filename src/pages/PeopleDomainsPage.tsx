import { useEffect, useId, useState } from "react";

import { EmptyState } from "../components/EmptyState";
import { InfoCallout } from "../components/InfoCallout";
import { LimitNotice } from "../components/LimitNotice";
import { LoadError } from "../components/LoadError";
import { PeopleHeader } from "../components/PeopleHeader";
import { Skeleton } from "../components/Skeleton";
import { StatusLine } from "../components/StatusLine";
import { useI18n } from "../i18n";
import { friendlyErrorMessage } from "../lib/api";
import { useActiveOrgId } from "../lib/accessRequests";
import { useAuth } from "../lib/auth";
import { type PlanTier, UPGRADE_TIERS } from "../lib/billing";
import { fetchOrgPolicy, type OrgPolicy, updateAllowedDomains } from "../lib/people";
import { cardClass, fieldHintClass, inputClass, primaryButtonClass, secondaryButtonClass } from "../lib/ui";
import { useAsyncResource } from "../lib/useAsyncResource";

const KNOB = "allowed_email_domains";

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Organization › People › Domains (UX step 7; a plan tab, Q6.3): which
 * email domains people must have to be invited or join. The tab is always
 * there; on a plan without it, it explains what it does and offers the plan
 * (`<LimitNotice>`). A list set while the plan had it stays enforced and can
 * only be cleared (grandfathered). */
export function PeopleDomainsPage() {
  const { token, sessionKey } = useAuth();
  const { t, messages } = useI18n();
  const orgId = useActiveOrgId();
  const fieldId = useId();
  const hintId = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);

  const policyRes = useAsyncResource<OrgPolicy>((signal) => fetchOrgPolicy(orgId!, token, signal), {
    deps: [sessionKey, orgId],
    enabled: orgId !== null,
  });
  const knob = policyRes.data?.knobs?.find((k) => k.key === KNOB);
  const own = asList(knob?.value);
  const saved = own.join("\n");
  useEffect(() => setText(saved), [saved]);

  async function save(domains: string[] | null) {
    if (orgId === null) return;
    setBusy(true);
    setStatus(t("common.saving"));
    setIsError(false);
    try {
      await updateAllowedDomains(orgId, domains, token);
      policyRes.reload();
      setStatus(t("people.domains.saved"));
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    } finally {
      setBusy(false);
    }
  }

  const entered = text.split(/[\s,;]+/).map((d) => d.trim()).filter(Boolean);
  const effective = asList(knob?.effective);
  const requires = (UPGRADE_TIERS as readonly string[]).includes(knob?.available_on ?? "")
    ? (knob!.available_on as PlanTier)
    : null;
  const lockedCopy: Record<string, string> = messages.people.domains.locked;

  let body;
  if (orgId === null) {
    body = <EmptyState>{t("people.noOrg")}</EmptyState>;
  } else if (policyRes.error) {
    body = (
      <LoadError
        title={t("people.domains.loadError")}
        message={policyRes.error}
        onRetry={policyRes.reload}
        what={t("nav.items.peopleDomains.title")}
      />
    );
  } else if (policyRes.data && !knob) {
    // An older gateway without the knob.
    body = <InfoCallout icon="info">{t("people.domains.unsupported")}</InfoCallout>;
  } else if (!knob) {
    body = (
      <div aria-busy="true">
        <span className="sr-only">{t("common.loading")}</span>
        <Skeleton className="h-24 w-full" />
      </div>
    );
  } else if (!knob.available && !knob.grandfathered) {
    body =
      knob.locked_reason === "tier" || !knob.locked_reason ? (
        <LimitNotice requires={requires}>{t("people.domains.what")}</LimitNotice>
      ) : (
        <InfoCallout icon="lock">
          {Object.hasOwn(lockedCopy, knob.locked_reason) ? lockedCopy[knob.locked_reason] : knob.locked_reason}
        </InfoCallout>
      );
  } else {
    body = (
      <section className={cardClass}>
        <p className="mb-3 text-sm text-gray-700 dark:text-gray-300">{t("people.domains.what")}</p>
        {knob.grandfathered && (
          <div className="mb-3">
            <InfoCallout icon="warning">{t("people.domains.grandfathered")}</InfoCallout>
          </div>
        )}
        <label htmlFor={fieldId} className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
          {t("people.domains.label")}
        </label>
        <textarea
          id={fieldId}
          className={`${inputClass} min-h-24 font-mono`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy || knob.grandfathered}
          aria-describedby={hintId}
          placeholder={t("people.domains.placeholder")}
        />
        <p id={hintId} className={fieldHintClass}>
          {t("people.domains.hint")}
        </p>
        {knob.source === "parent" && effective.length > 0 && (
          <p className={fieldHintClass}>{t("people.domains.parent", { list: effective.join(", ") })}</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!knob.grandfathered && (
            <button
              type="button"
              className={primaryButtonClass}
              disabled={busy}
              onClick={() => save(entered.length > 0 ? entered : null)}
            >
              {t("people.domains.save")}
            </button>
          )}
          {own.length > 0 && (
            <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => save(null)}>
              {t("people.domains.clear")}
            </button>
          )}
        </div>
        <StatusLine isError={isError} className="mb-0 mt-2">
          {status}
        </StatusLine>
      </section>
    );
  }

  return (
    <>
      {/* No seat banner here: at most one upgrade note per page (Q6.3). */}
      <PeopleHeader title={t("nav.items.peopleDomains.title")} seats={false} />
      {body}
    </>
  );
}
