import { Link, useLocation } from "react-router-dom";

import { Icon } from "../components/Icon";
import { PageHeader } from "../components/PageHeader";
import { useI18n } from "../i18n";
import { primaryButtonClass, secondaryButtonClass } from "../lib/ui";

/** The page for a path the app doesn't have (nginx serves the SPA for every
 * path, so an unknown one lands here): what happened, a search that opens the
 * command palette, and the way home. Old URLs that moved are redirected
 * before they get here (lib/routes.ts). */
export function NotFoundPage({ onSearch }: { onSearch: () => void }) {
  const { pathname } = useLocation();
  const { t } = useI18n();
  return (
    <section>
      <PageHeader icon="help" title={t("notFound.title")} subtitle={t("notFound.body", { path: pathname })} />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onSearch} className={primaryButtonClass}>
          <Icon name="search" size={16} />
          {t("notFound.search")}
        </button>
        <Link to="/" className={secondaryButtonClass}>
          {t("notFound.backHome")}
        </Link>
      </div>
    </section>
  );
}
