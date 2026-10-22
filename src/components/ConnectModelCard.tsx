import { Link } from "react-router-dom";

import { useI18n } from "../i18n";
import { MODEL_PROVIDERS_DOCS_URL, useReadiness } from "../lib/readiness";
import { useCan } from "../lib/useCan";
import { ExternalLink } from "./ExternalLink";
import { Icon } from "./Icon";
import { InfoCallout } from "./InfoCallout";

/** Home's first step when the readiness endpoint's `model` check fails: nothing
 * else on the golden path works without a model (uploads can't be embedded,
 * Ask can't answer). Someone who can connect one (an org owner/admin or an
 * instance admin) gets the providers page and the docs; anyone else a note to
 * ask an administrator. Renders nothing while the check passes, is loading, or
 * couldn't be read. */
export function ConnectModelCard() {
  const { t } = useI18n();
  const readiness = useReadiness();
  const canConnect = useCan("org.ai.manage");

  const model = readiness.data?.checks.model;
  if (!model || model.ready) return null;

  if (!canConnect) {
    return (
      <div className="mb-6">
        <InfoCallout icon="models" tone="warn">
          {t("onboarding.model.askAdmin")}
        </InfoCallout>
      </div>
    );
  }

  return (
    <section
      aria-labelledby="connect-model-title"
      className="mb-6 flex items-start gap-4 rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm dark:border-amber-900 dark:bg-amber-950/40"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white">
        <Icon name="models" size={22} />
      </span>
      <div className="min-w-0 flex-1">
        <h2
          id="connect-model-title"
          className="text-base font-semibold text-gray-900 dark:text-gray-100"
        >
          {t("onboarding.model.title")}
        </h2>
        <p className="mt-0.5 text-sm text-gray-700 dark:text-gray-300">
          {model.reason === "model_service_unavailable"
            ? t("onboarding.model.unavailable")
            : t("onboarding.model.noModel")}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-medium">
          <Link
            to="/platform/providers"
            className="inline-flex items-center gap-1.5 text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
          >
            {t("onboarding.model.providers")}
            <Icon name="arrow" size={14} />
          </Link>
          <ExternalLink
            href={MODEL_PROVIDERS_DOCS_URL}
            className="text-indigo-600 underline hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
          >
            {t("onboarding.model.docs")}
          </ExternalLink>
        </div>
      </div>
    </section>
  );
}
