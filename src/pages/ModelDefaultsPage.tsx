import { useMemo } from "react";

import { ModelDefaultsPanel } from "../components/ModelDefaultsPanel";
import { PageHeader } from "../components/PageHeader";
import { useI18n } from "../i18n";
import { useAuth } from "../lib/auth";
import { listProviders } from "../lib/modelProviders";
import { useAsyncResource } from "../lib/useAsyncResource";
import { useCan } from "../lib/useCan";

/** Organization › AI › Model defaults (UX step 9): the default model per
 * task, moved off the providers page into its own tab. The panel owns its
 * loading, error and read-only states. Any member may read the defaults;
 * org.ai.defaults.manage changes them. */
export function ModelDefaultsPage() {
  const { token, sessionKey } = useAuth();
  const { t } = useI18n();
  const canEdit = useCan("org.ai.defaults.manage");
  const canListProviders = useCan("org.ai.providers.view");
  // Self-hosted provider rows (`is_local`) serve Local models; the pickers
  // label them so, the same as the knowledge-base and Ask pickers. A failed
  // load only loses that label.
  const providersRes = useAsyncResource((signal) => listProviders(token, signal), {
    enabled: !!token && canListProviders,
    deps: [sessionKey],
  });
  const localProviders = useMemo(
    () => new Set((providersRes.data ?? []).filter((p) => p.is_local).map((p) => p.id)),
    [providersRes.data],
  );

  return (
    <>
      <PageHeader
        icon="models"
        title={t("nav.items.orgAiDefaults.title")}
        subtitle={t("orgAi.defaultsSubtitle")}
      />
      <ModelDefaultsPanel
        token={token}
        canEdit={canEdit}
        sessionKey={sessionKey}
        localProviders={localProviders}
      />
    </>
  );
}
