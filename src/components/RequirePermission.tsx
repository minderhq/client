import type { ReactNode } from "react";

import type { Requirement } from "../lib/permissions";
import { useAllows } from "../lib/useCan";
import { ForbiddenPage } from "../pages/ForbiddenPage";

/** A route guard (#131): renders `children` only when the caller meets
 * `requires` (a permission key, any signed-in member, or the Platform Admin;
 * see useCan), and the forbidden page otherwise -- at the same URL, so a
 * direct link never ends on a blank or broken page, and signing in or getting
 * access later lands on the page itself. */
export function RequirePermission({
  requires,
  children,
}: {
  requires: Requirement;
  children: ReactNode;
}) {
  const allowed = useAllows(requires);
  return allowed ? <>{children}</> : <ForbiddenPage requires={requires} />;
}
