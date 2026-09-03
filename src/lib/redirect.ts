/** Navigate the browser to an external, provider-hosted URL (e.g. a billing
 * checkout or customer-portal page). Isolated in its own module so callers stay
 * unit-testable — tests mock this module instead of fighting jsdom's
 * non-configurable `window.location`. */
export function redirectTo(url: string): void {
  window.location.assign(url);
}
