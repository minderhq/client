import { Link, useLocation } from "react-router-dom";

import { PageHeader } from "../components/PageHeader";
import { useI18n, type Messages } from "../i18n";
import { requestKindFor } from "../lib/accessRequests";
import { useAuth } from "../lib/auth";
import { MEMBER, PLATFORM_ADMIN, type Requirement } from "../lib/permissions";
import { mutedTextClass, primaryButtonClass, secondaryButtonClass } from "../lib/ui";

type Audience = keyof Messages["access"]["audience"];

/** Who a requirement is open to today, in words. */
function audience(requires: Requirement): Audience {
  if (requires === MEMBER) return "members";
  if (requires === PLATFORM_ADMIN) return "platformAdmins";
  if (requires.startsWith("org.billing.")) return "billing";
  // The audit log is an operator screen today (its API checks the operator).
  if (requires === "org.audit.view") return "platformAdmins";
  if (requires.startsWith("team.")) return "teamAdmins";
  return "orgAdmins";
}

/** What a route guard shows instead of a page the caller may not open: who
 * the page is for, a "Request access" action, and the way home. A signed-out
 * visitor is asked to sign in instead, and comes back here afterwards. */
export function ForbiddenPage({ requires }: { requires: Requirement }) {
  const { isAuthenticated } = useAuth();
  const { pathname, search, hash } = useLocation();
  const { t } = useI18n();

  if (!isAuthenticated) {
    return (
      <section>
        <PageHeader icon="lock" title={t("access.signInTitle")} subtitle={t("access.signInBody")} />
        <div className="flex flex-wrap gap-2">
          <Link
            to="/login"
            state={{ from: `${pathname}${search}${hash}` }}
            className={primaryButtonClass}
          >
            {t("common.logIn")}
          </Link>
          <Link to="/" className={secondaryButtonClass}>
            {t("access.backHome")}
          </Link>
        </div>
      </section>
    );
  }

  const requestKind = requestKindFor(requires);
  return (
    <section>
      <PageHeader
        icon="lock"
        title={t("access.forbiddenTitle")}
        subtitle={t("access.forbiddenBody", {
          audience: t(`access.audience.${audience(requires)}`),
        })}
      />
      <div className="flex flex-wrap gap-2">
        {/* Page access is not a request kind the API knows (lib/accessRequests.ts):
          the action is shown, disabled, so the way to ask is visible where it will be. */}
        <button
          type="button"
          className={primaryButtonClass}
          disabled={requestKind === null}
          aria-describedby={requestKind === null ? "request-access-soon" : undefined}
        >
          {t("access.requestAccess")}
        </button>
        <Link to="/" className={secondaryButtonClass}>
          {t("access.backHome")}
        </Link>
      </div>
      {requestKind === null && (
        <p id="request-access-soon" className={`mt-3 ${mutedTextClass}`}>
          {t("access.requestAccessSoon")}
        </p>
      )}
    </section>
  );
}
