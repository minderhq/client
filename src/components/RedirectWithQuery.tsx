import { generatePath, Navigate, useLocation, useParams } from "react-router-dom";

/** A `<Navigate replace>` that keeps the query string and hash, and fills
 * `:params` in `to` from the matched route. A plain `<Navigate to="/x">`
 * drops `?source=private` or `?q=crm` from an old bookmark, so the user lands
 * on the right page with the wrong filter. */
export function RedirectWithQuery({ to }: { to: string }) {
  const { search, hash } = useLocation();
  const params = useParams();
  return <Navigate to={{ pathname: generatePath(to, params), search, hash }} replace />;
}
