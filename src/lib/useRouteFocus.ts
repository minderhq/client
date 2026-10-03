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
 * Runs on pathname changes only: a filter that rewrites the query string
 * (?q=, ?source=) must not yank focus out of the field being typed in. It
 * skips the first render and REPLACE navigations (redirects, including the
 * legacy-URL redirects), so loading a page or an old bookmark leaves focus
 * where the browser put it. */
export function useRouteFocus(container: RefObject<HTMLElement | null>): void {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const firstPathname = useRef(pathname);

  useEffect(() => {
    if (pathname === firstPathname.current) return;
    firstPathname.current = "";
    if (navigationType === "REPLACE") return;
    // After paint, so the new page (and its heading) is in the DOM.
    const id = requestAnimationFrame(() => {
      const root = container.current;
      if (!root) return;
      const target = root.querySelector<HTMLElement>("h1") ?? root;
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [pathname, navigationType, container]);
}
