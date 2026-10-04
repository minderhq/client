import { cardClass } from "../lib/ui";
import { Skeleton } from "./Skeleton";

/** Placeholder cards for a card list whose first load is still in flight, so a
 * page never shows its "nothing here" state before it actually knows (#2195).
 * First used by Installed plugins (#2193); shared by every marketplace list.
 *
 * Purely visual (`aria-hidden`): pair it with a polite `StatusLine` ("Loading
 * …") so screen-reader users hear the same thing sighted users see. */
export function CardListSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div aria-hidden="true" data-testid="card-list-skeleton">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`mb-4 ${cardClass}`}>
          <Skeleton className="h-5 w-48" />
          <div className="mt-2 flex gap-1.5">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-40" />
          </div>
        </div>
      ))}
    </div>
  );
}
