import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";

import { lastInteractedElement, trackLastInteraction } from "./lastInteraction";
import { pushModalLayer } from "./modalLayer";
import { focusPageStart } from "./useRouteFocus";

/** Elements that take part in sequential (Tab) focus navigation. */
const TABBABLE = [
  "a[href]",
  "button",
  "input:not([type='hidden'])",
  "select",
  "textarea",
  "summary",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** The elements Tab can reach inside `container`, in document order: enabled,
 * not hidden or inert, and -- like the browser -- only the checked radio of a
 * radio group that has one. */
export function tabbableIn(container: HTMLElement): HTMLElement[] {
  const radios = Array.from(container.querySelectorAll<HTMLInputElement>("input[type='radio']"));
  return Array.from(container.querySelectorAll<HTMLElement>(TABBABLE)).filter((el) => {
    if (el.matches(":disabled") || el.closest("[hidden], [inert]")) return false;
    if (el.tabIndex < 0) return false;
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
}

export interface Modal {
  /** The modal's root: a direct child of <body> (portalled), covering the
   * viewport. Registered with lib/modalLayer.ts while open. */
  layerRef: React.RefObject<HTMLDivElement>;
  /** The dialog panel: Tab is trapped in it, initial focus goes into it. */
  panelRef: React.RefObject<HTMLDivElement>;
  /** Close now: lift `inert` and return focus synchronously. Optional -- a
   * modal whose `open` goes false does the same in its commit -- but lets a
   * caller return focus BEFORE doing something else (resolving a promise). */
  close: () => void;
  /** Escape → onDismiss; Tab → trap. Put on the layer element. */
  onKeyDown: (e: KeyboardEvent) => void;
  /** Click-to-dismiss for a backdrop that is the layer element itself. Only a
   * press that starts AND ends on the backdrop dismisses: a drag that starts
   * in the panel (selecting text in a field) and ends outside doesn't. */
  backdropProps: {
    onMouseDown: (e: MouseEvent) => void;
    onClick: (e: MouseEvent) => void;
  };
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
 *   to the page's heading if that is gone or disabled. Unmounting the owner
 *   with the modal still open only lifts `inert`; it doesn't move focus.
 *
 * Rendering stays with the caller (see components/Dialog.tsx for the standard
 * centred dialog), so overlays with their own layout (the command palette)
 * share the behaviour too. */
export function useModal({ open, onDismiss }: UseModalOptions): Modal {
  const layerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const releaseRef = useRef<(() => void) | null>(null);
  /** One open "session": where focus goes back to, and whether it has. Kept
   * across StrictMode's effect re-run so the origin is captured only once. */
  const sessionRef = useRef<{ returnTo: HTMLElement | null; returned: boolean } | null>(null);
  /** Whether the current press started on the backdrop (null: no press seen,
   * e.g. a keyboard- or script-generated click). */
  const pressedOnBackdropRef = useRef<boolean | null>(null);

  useEffect(() => trackLastInteraction(), []);

  const close = useCallback(() => {
    // Lift `inert` first: an inert element can't take focus.
    releaseRef.current?.();
    const session = sessionRef.current;
    if (session && !session.returned) {
      session.returned = true;
      returnFocus(session.returnTo);
    }
  }, []);

  // Layout effect: inert and focus are in place before the browser paints or
  // handles the next event. The cleanup also runs when the owner unmounts with
  // the modal open, so the page never stays inert.
  useLayoutEffect(() => {
    if (!open) {
      // Closed by `open` going false (not by close()): return focus now. The
      // previous run's cleanup has already released the layer.
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session && !session.returned) returnFocus(session.returnTo);
      return;
    }
    const layer = layerRef.current;
    if (!layer) return;
    sessionRef.current ??= { returnTo: focusOrigin(), returned: false };
    const release = pushModalLayer(layer);
    releaseRef.current = release;
    if (panelRef.current) focusInitial(panelRef.current);
    return () => {
      release();
      if (releaseRef.current === release) releaseRef.current = null;
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
      pressedOnBackdropRef.current = e.target === e.currentTarget;
    },
    onClick(e: MouseEvent) {
      const pressedOnBackdrop = pressedOnBackdropRef.current;
      pressedOnBackdropRef.current = null;
      if (e.target !== e.currentTarget || pressedOnBackdrop === false) return;
      onDismiss();
    },
  };

  return { layerRef, panelRef, close, onKeyDown, backdropProps };
}
