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
