import { Link } from "react-router-dom";

import { useI18n } from "../i18n";
import { usePendingRequestCount } from "../lib/accessRequests";
import { ROUTES } from "../lib/routes";
import { badgeBaseClass, badgeTone } from "../lib/ui";
import { Icon } from "./Icon";
import { SeatBanner } from "./LimitNotice";
import { PageHeader } from "./PageHeader";

/** The top of every Organization › People page (ux-design §5): the page's
 * title, a link to the requests inbox with how many wait for the caller
 * (the inbox itself is the Requests page), and the honest seat count. */
export function PeopleHeader({
  title,
  subtitle,
  seats = true,
}: {
  title: string;
  subtitle?: string;
  /** Show the seat count (off where another upgrade note owns the page). */
  seats?: boolean;
}) {
  const { t, plural } = useI18n();
  const pending = usePendingRequestCount();
  return (
    <>
      <PageHeader
        icon="users"
        title={title}
        subtitle={subtitle}
        actions={
          <Link
            to={ROUTES.requests}
            className="flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            <Icon name="send" size={15} />
            {t("people.requests")}
            {pending > 0 && (
              <span className={`${badgeBaseClass} ${badgeTone.warn}`}>
                <span aria-hidden="true">{pending}</span>
                <span className="sr-only">{plural("requests.pendingBadge", pending)}</span>
              </span>
            )}
          </Link>
        }
      />
      {seats && <SeatBanner />}
    </>
  );
}
