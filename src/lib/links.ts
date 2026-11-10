/** OpenWebUI link, baked at BUILD time (Vite convention) like the other VITE_*
 * config — see api.ts's `oidcLoginUrl`/`autheliaPortalUrl`.
 *
 * The old `http://${hostname}:8080` was wrong on any real deployment: the SPA is
 * served over HTTPS via Traefik and OpenWebUI is Traefik-fronted (not on host
 * :8080), so that URL was mixed-content (browser-blocked on an https page) and
 * pointed at nothing. NO default: unset → empty, and callers render "OpenWebUI"
 * as plain text instead of a dead link. A real deployment sets
 * `VITE_OPENWEBUI_URL` to OpenWebUI's routed URL (e.g. https://chat.<domain>). */
export const openWebUiUrl: string = import.meta.env.VITE_OPENWEBUI_URL || "";

/** `base` as an absolute URL without a trailing slash. A same-origin base such
 * as the default "/api" resolves against `origin`; an absolute one is kept.
 * For links used outside this page: the public chat link and embed snippet. */
export function absoluteUrl(base: string, origin: string = window.location.origin): string {
  return new URL(base, origin).href.replace(/\/$/, "");
}
