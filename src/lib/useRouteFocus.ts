import { useEffect, useRef, type RefObject } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/** Move keyboard and screen-reader focus to the new page after a client-side
 * navigation, the way a full page load would.
 *
 * Without this, following a sidebar link or a tab leaves focus on that link
 * while the whole page changes underneath it, so a screen reader announces
 * nothing and a keyboard user has to tab back through the nav. Focus goes to
 * the page's <h1> (made programmatically focusable), or to `container` if the
 * page has none.
 *
 * Runs only when the pathname actually differs from the previous one: a
 * query-only change (?q=, ?source=), whether it pushes, replaces or comes from
 * Back, must not yank focus out of the field being used. The previous
 * pathname is tracked in a ref rather than inferred from the effect re-running,
 * because the effect also re-runs when only the navigation type changes.
 * REPLACE navigations (redirects, including the legacy-URL ones) never move
 * focus, so loading a page or an old bookmark leaves focus where the browser
 * put it. */
export function useRouteFocus(container: RefObject<HTMLElement | null>): void {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const previousPathname = useRef(pathname);

  useEffect(() => {
    if (pathname === previousPathname.current) return;
    previousPathname.current = pathname;
    if (navigationType === "REPLACE") return;
    // After paint, so the new page (and its heading) is in the DOM.
    const id = requestAnimationFrame(() => {
      if (container.current) focusPageStart(container.current);
    });
    return () => cancelAnimationFrame(id);
  }, [pathname, navigationType, container]);
}

/** Focus the page's <h1> inside `container` (made programmatically
 * focusable), or `container` itself if there is none. Also the fallback when
 * focus can't go back where it came from (e.g. after a dialog closes). */
export function focusPageStart(container: HTMLElement): void {
  const target = container.querySelector<HTMLElement>("h1") ?? container;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
}

/** For a navigation that took focus away from where it was (e.g. a command
 * palette selection, which closes without returning focus): if the new page
 * doesn't get it either -- the route redirected (REPLACE, which doesn't move
 * focus) or the navigation was blocked -- put it on the page's heading rather
 * than leave it on <body>. Checks two frames on, past useRouteFocus's own. */
export function focusPageStartIfLost(): void {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body) return;
      const main = document.querySelector("main");
      if (main) focusPageStart(main);
    }),
  );
}
