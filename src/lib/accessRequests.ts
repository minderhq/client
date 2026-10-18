import type { Requirement } from "./permissions";

/** A kind of access request the API accepts. None exist yet: the request
 * system (join an org or team, install a plugin, add a model, change the plan)
 * is still to come, so there is no kind to name here. */
export type AccessRequestKind = never;

/**
 * The request a caller locked out of `requires` could send, or null when
 * there is none. The forbidden page shows its "Request access" action only
 * enabled when this returns a kind.
 *
 * TODO(#126): map requirements to request kinds once the API accepts access
 * requests, and send them from the forbidden page.
 */
export function requestKindFor(requires: Requirement): AccessRequestKind | null {
  void requires;
  return null;
}
