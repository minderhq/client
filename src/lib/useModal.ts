import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";

import { lastInteractedElement, trackLastInteraction } from "./lastInteraction";
import { isTopModalLayer, pushModalLayer } from "./modalLayer";
import { focusPageStart } from "./useRouteFocus";

/** Elements that take part in sequential (Tab) focus navigation. */
const TABBABLE = [
  "a[href]",
  "button",
  "input:not([type='hidden'])",
  "select",
  "textarea",
  "summary",
  // Editable: "" and "true" (the same state) and "plaintext-only"; the
  // attribute's value is case-insensitive.
  "[contenteditable='']",
  "[contenteditable='true' i]",
  "[contenteditable='plaintext-only' i]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** Whether `el` sits in the hidden content of a closed <details> (anything but
 * that details' own <summary>), at any level of nesting. */
function inClosedDetails(el: HTMLElement): boolean {
  let details = el.parentElement?.closest("details:not([open])");
  while (details) {
    const summary = Array.from(details.children).find((c) => c.localName === "summary");
    if (!summary?.contains(el)) return true;
    details = details.parentElement?.closest("details:not([open])");
  }
  return false;
}

/** A test for "is this element rendered (has a box)?", or null where there is
 * no layout to ask (jsdom, which reports no boxes for anything -- there, the
 * `hidden` / closed-details checks are all we can do). */
function renderedTest(container: HTMLElement): ((el: HTMLElement) => boolean) | null {
  if (typeof container.checkVisibility === "function") {
    // Also false under visibility:hidden, which can't take focus either.
    return (el) => el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true });
  }
  if (container.getClientRects().length === 0) return null;
  return (el) => el.getClientRects().length > 0;
}

/** The elements Tab can reach inside `container`, in document order: enabled,
 * rendered (not hidden, not display:none, not in a closed <details>), not
 * inert, and -- like the browser -- only the checked radio of a radio group
 * that has one. */
export function tabbableIn(container: HTMLElement): HTMLElement[] {
  const radios = Array.from(container.querySelectorAll<HTMLInputElement>("input[type='radio']"));
  const isRendered = renderedTest(container);
  return Array.from(container.querySelectorAll<HTMLElement>(TABBABLE)).filter((el) => {
    if (el.matches(":disabled") || el.closest("[hidden], [inert]")) return false;
    // A negative (or invalid) tabindex takes it out of the Tab order. Without
    // one, everything matched is in it -- even where jsdom, which doesn't
    // know contenteditable, reports -1.
    if (el.hasAttribute("tabindex") && el.tabIndex < 0) return false;
    if (inClosedDetails(el)) return false;
    if (isRendered && !isRendered(el)) return false;
    if (el instanceof HTMLInputElement && el.type === "radio" && !el.checked && el.name) {
      return !radios.some((r) => r.name === el.name && r.form === el.form && r.checked);
    }
    return true;
  });
}

/** What should get focus back when a modal opening now closes: the focused
 * element, or -- where a click doesn't focus the button (Safari, Firefox on
 * macOS) -- the element last pressed (lib/lastInteraction.ts). */
function focusOrigin(): HTMLElement | null {
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body
    ? active
    : lastInteractedElement();
}

/** Focus `target`; if it can't take focus (removed, disabled, hidden), go to
 * the page's heading instead -- the same place a navigation puts it
 * (lib/useRouteFocus.ts). */
function returnFocus(target: HTMLElement | null) {
  if (target?.isConnected) target.focus();
  if (target && document.activeElement === target) return;
  const main = document.querySelector("main");
  if (main) focusPageStart(main);
}

/** Move focus into a just-opened panel, unless something in it already has
 * focus: the element marked `data-autofocus`, else the first tabbable one,
 * else the panel itself. */
function focusInitial(panel: HTMLElement) {
  if (panel.contains(document.activeElement)) return;
  const target =
    panel.querySelector<HTMLElement>("[data-autofocus]") ?? tabbableIn(panel)[0] ?? panel;
  if (target === panel && !panel.hasAttribute("tabindex")) panel.setAttribute("tabindex", "-1");
  target.focus();
}

/** Keep Tab / Shift+Tab cycling inside `panel` instead of escaping to the
 * browser chrome (the page behind is inert, so it can't go there). */
function trapTab(e: KeyboardEvent, panel: HTMLElement) {
  const items = tabbableIn(panel);
  const active = document.activeElement;
  if (items.length === 0) {
    e.preventDefault();
    focusInitial(panel);
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  if (active === panel || !panel.contains(active)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  } else if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

export interface UseModalOptions {
  /** Whether the modal is showing. Its layer element must be rendered (into
   * <body>, through a portal) whenever this is true. */
  open: boolean;
  /** Escape, or a click on the backdrop, asks to close. The owner decides
   * whether to (e.g. not while a request is in flight). */
  onDismiss: () => void;
  /** Identity of what the modal is showing (e.g. the pending request). A new
   * value while `open` stays true starts a fresh session:
   *
   * - after close() (one confirm chained straight after another, so React
   *   batches the close and the reopen into one render), as if the modal had
   *   closed and reopened: its layer goes back on top like any modal that
   *   opens, focus moves into the panel, and focus will return to where it
   *   was when the new session started;
   * - while still open (the content replaced in place), the layer keeps its
   *   place in the stack -- a modal stacked above stays on top -- and focus
   *   moves in only if this modal is the top one. Focus still returns to
   *   where it was before the first session. */
  sessionKey?: unknown;
}

export interface CloseOptions {
  /** Return focus to where it was when the modal opened (default true). Pass
   * false when what closes the modal moves focus itself -- e.g. a navigation,
   * which puts it on the new page's heading (lib/useRouteFocus.ts). */
  restoreFocus?: boolean;
}

export interface Modal {
  /** The modal's root: a direct child of <body> (portalled), covering the
   * viewport. Registered with lib/modalLayer.ts while open. */
  layerRef: React.RefObject<HTMLDivElement>;
  /** The dialog panel: Tab is trapped in it, initial focus goes into it. */
  panelRef: React.RefObject<HTMLDivElement>;
  /** Close now: lift `inert` and return focus synchronously. Optional -- a
   * modal whose `open` goes false does the same in its commit -- but lets a
   * caller return focus BEFORE doing something else (resolving a promise), or
   * not at all (`restoreFocus: false`). */
  close: (options?: CloseOptions) => void;
  /** Escape → onDismiss; Tab → trap. Put on the layer element. */
  onKeyDown: (e: KeyboardEvent) => void;
  /** Click-to-dismiss for a backdrop that is the layer element itself. Only a
   * press that starts AND ends on the backdrop dismisses: neither a drag that
   * starts in the panel (selecting text in a field) and ends outside, nor one
   * that starts outside and ends in the panel. */
  backdropProps: {
    onMouseDown: (e: MouseEvent) => void;
    onMouseUp: (e: MouseEvent) => void;
    onClick: (e: MouseEvent) => void;
  };
}

/** One open "session": where focus goes back to, and whether it has. */
interface Session {
  key: unknown;
  returnTo: HTMLElement | null;
  returned: boolean;
}

/** The behaviour every modal overlay shares, in one place:
 *
 * - while open, everything outside it is `inert` (lib/modalLayer.ts), with
 *   correct stacking when another modal opens on top;
 * - on open, focus moves into the panel (`data-autofocus`, else the first
 *   tabbable element). Use `data-autofocus`, not React's `autoFocus`, for the
 *   initial target: `autoFocus` runs before this hook can note where focus
 *   came from;
 * - Tab and Shift+Tab stay inside the panel; Escape asks to dismiss;
 * - on close, focus returns to what had it when the modal opened (or, where a
 *   click didn't focus the trigger, the element last pressed), falling back
 *   to the page's heading if that is gone or disabled -- unless the close
 *   asked not to (`close({ restoreFocus: false })`). Unmounting the owner
 *   with the modal still open only lifts `inert`; it doesn't move focus.
 *
 * Rendering stays with the caller (see components/Dialog.tsx for the standard
 * centred dialog), so overlays with their own layout (the command palette)
 * share the behaviour too. */
export function useModal({ open, onDismiss, sessionKey }: UseModalOptions): Modal {
  const layerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const releaseRef = useRef<(() => void) | null>(null);
  /** The current session. Kept across StrictMode's effect re-run so the
   * origin is captured only once per session. */
  const sessionRef = useRef<Session | null>(null);
  /** Whether the current press started / ended on the backdrop (null: not
   * seen, e.g. a keyboard- or script-generated click). */
  const pressRef = useRef<{ start: boolean | null; end: boolean | null }>({
    start: null,
    end: null,
  });

  useEffect(() => trackLastInteraction(), []);

  const close = useCallback(({ restoreFocus = true }: CloseOptions = {}) => {
    // Lift `inert` first: an inert element can't take focus.
    releaseRef.current?.();
    releaseRef.current = null;
    const session = sessionRef.current;
    if (session && !session.returned) {
      session.returned = true;
      if (restoreFocus) returnFocus(session.returnTo);
    }
  }, []);

  // Layout effects: inert and focus are in place before the browser paints or
  // handles the next event.
  //
  // The session: captured, registered and focused per open and per
  // sessionKey. The return target is captured before the layer goes on (an
  // inert element loses focus), and the layer only goes on if it isn't
  // registered already, so restarting a session never reorders the stack.
  useLayoutEffect(() => {
    if (!open) {
      // Closed by `open` going false (not by close()): return focus now. The
      // effect below has already released the layer.
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session && !session.returned) returnFocus(session.returnTo);
      return;
    }
    const layer = layerRef.current;
    if (!layer) return;
    const session = sessionRef.current;
    if (!session || session.key !== sessionKey) {
      sessionRef.current = {
        key: sessionKey,
        // A new session straight after a closed one (focus was returned to
        // the trigger): capture afresh. Replacing one still open (focus is in
        // the panel): keep where the first one came from.
        returnTo: session && !session.returned ? session.returnTo : focusOrigin(),
        returned: false,
      };
    }
    // Not registered: opening (or reopening after close()) -- on top.
    releaseRef.current ??= pushModalLayer(layer);
    if (panelRef.current && isTopModalLayer(layer)) focusInitial(panelRef.current);
  }, [open, sessionKey]);

  // The layer's registration ends when the modal closes or the owner
  // unmounts with it open (so the page never stays inert) -- not when only
  // the session changes. On close, React runs this cleanup before the effect
  // above re-runs, so `inert` is lifted before focus is returned.
  useLayoutEffect(() => {
    if (!open) return;
    return () => {
      releaseRef.current?.();
      releaseRef.current = null;
    };
  }, [open]);

  function onKeyDown(e: KeyboardEvent) {
    // A nested modal (React events bubble out of portals) already handled it.
    if (e.isDefaultPrevented()) return;
    if (e.key === "Escape") {
      e.preventDefault();
      onDismiss();
    } else if (e.key === "Tab" && panelRef.current) {
      trapTab(e, panelRef.current);
    }
  }

  const backdropProps = {
    onMouseDown(e: MouseEvent) {
      pressRef.current = { start: e.target === e.currentTarget, end: null };
    },
    onMouseUp(e: MouseEvent) {
      pressRef.current.end = e.target === e.currentTarget;
    },
    onClick(e: MouseEvent) {
      const { start, end } = pressRef.current;
      pressRef.current = { start: null, end: null };
      if (e.target !== e.currentTarget) return;
      // A pointer press (seen at either end) must start and end on the
      // backdrop. Pressed across the two, the browser fires the click on
      // their common ancestor -- the backdrop -- so the click alone can't
      // tell. A click with no press seen (keyboard, script) still dismisses.
      if ((start !== null || end !== null) && !(start && end)) return;
      onDismiss();
    },
  };

  return { layerRef, panelRef, close, onKeyDown, backdropProps };
}
