import { generatePath, Navigate, useLocation, useParams } from "react-router-dom";

/** A `<Navigate replace>` that keeps the query string and hash, and fills
 * `:params` in `to` from the matched route. A plain `<Navigate to="/x">`
 * drops `?source=private` or `?q=crm` from an old bookmark, so the user lands
 * on the right page with the wrong filter.
 *
 * Param encoding: `useParams()` returns DECODED values ("a/b" for "a%2Fb"),
 * and React Router 7's `generatePath` percent-encodes each param back
 * (encodeURIComponent semantics), so "/", "?", "#", "%" and non-ASCII ids
 * survive the redirect intact. Don't encode them again here: that would
 * double-encode ("a%252Fb"). App.test.tsx pins this, so a router change
 * that stops encoding fails CI instead of producing broken paths. */
export function RedirectWithQuery({ to }: { to: string }) {
  const { search, hash } = useLocation();
  const params = useParams();
  return <Navigate to={{ pathname: generatePath(to, params), search, hash }} replace />;
}
