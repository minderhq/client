import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { lastInteractedElement, trackLastInteraction } from "../lib/lastInteraction";
import { pushModalLayer } from "../lib/modalLayer";
import { destructiveButtonClass, primaryButtonClass, secondaryButtonClass } from "../lib/ui";
import { focusPageStart } from "../lib/useRouteFocus";

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  /** Filled red confirm button for hard-to-undo actions (delete/uninstall),
   * distinct in weight from routine confirmations (disable/reconcile). */
  danger?: boolean;
  /** Structured detail under the message -- e.g. a preview list of what the
   * action will change. Read out with the message (aria-describedby). */
  details?: ReactNode;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
  /** What had focus when confirm() was called -- usually the button that
   * asked -- so closing the dialog can put focus back there. Where a click
   * doesn't focus the button (Safari, Firefox on macOS), the element last
   * pressed instead. */
  returnFocusTo: HTMLElement | null;
}

/** Imperative confirm-dialog replacement for `window.confirm()` — a branded
 * modal instead of the browser's native dialog, with distinct visual weight
 * for destructive vs. routine actions. Usage:
 *
 *   const { confirm, dialog } = useConfirm();
 *   async function handleDelete() {
 *     if (!(await confirm({ title: "...", message: "...", danger: true }))) return;
 *     ...
 *   }
 *   return <>{dialog}...</>
 *
 * The dialog is portalled into <body>, so its fixed backdrop covers the whole
 * viewport (sidebar and header included) wherever `dialog` is placed, and the
 * rest of the app is `inert` while it is open (see lib/modalLayer.ts). On
 * close, focus goes back to whatever had it when confirm() was called (or, if
 * that is gone or disabled, to the page's heading, as after a navigation),
 * before the returned promise resolves -- so a caller that moves focus after
 * the `await` still wins.
 */
export function useConfirm() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const releaseLayerRef = useRef<(() => void) | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const open = pending !== null;

  useEffect(() => trackLastInteraction(), []);

  const confirm = useCallback((options: ConfirmOptions) => {
    const active = document.activeElement;
    const returnFocusTo =
      active instanceof HTMLElement && active !== document.body
        ? active
        : lastInteractedElement();
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve, returnFocusTo });
    });
  }, []);

  // While open, everything outside the dialog is inert. The cleanup also runs
  // when the owning component unmounts with the dialog still open, so the page
  // never stays inert; focus is only moved back on an explicit close (settle).
  useLayoutEffect(() => {
    if (!open || !backdropRef.current) return;
    const release = pushModalLayer(backdropRef.current);
    releaseLayerRef.current = release;
    return () => {
      release();
      if (releaseLayerRef.current === release) releaseLayerRef.current = null;
    };
  }, [open]);

  function settle(result: boolean) {
    if (!pending) return;
    // Lift `inert` first: an inert element can't take focus.
    releaseLayerRef.current?.();
    returnFocus(pending.returnFocusTo);
    pending.resolve(result);
    setPending(null);
  }

  /** Focus `target`; if it can't take focus (removed, disabled, hidden) and
   * focus would otherwise drop to <body>, go to the page's heading instead
   * -- the same place a navigation puts it (lib/useRouteFocus.ts). */
  function returnFocus(target: HTMLElement | null) {
    if (target?.isConnected) target.focus();
    if (target && document.activeElement === target) return;
    const main = document.querySelector("main");
    if (main) focusPageStart(main);
  }

  /** Keep Tab/Shift+Tab cycling within the dialog's two buttons instead of
   * escaping to the page behind it -- autoFocus alone only sets the INITIAL
   * focus, it doesn't constrain where Tab can go afterwards. */
  function handleTabTrap(e: React.KeyboardEvent) {
    if (e.key !== "Tab" || !panelRef.current) return;
    const focusable = panelRef.current.querySelectorAll<HTMLElement>("button");
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const dialog =
    pending &&
    createPortal(
      <div
        ref={backdropRef}
        role="presentation"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        onClick={() => settle(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") settle(false);
          else handleTabTrap(e);
        }}
      >
        <div
          ref={panelRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className={`w-full ${pending.details ? "max-w-md" : "max-w-sm"} rounded-xl bg-white p-5 shadow-xl dark:bg-gray-900`}
          onClick={(e) => e.stopPropagation()}
        >
          <h2
            id={titleId}
            className="text-base font-semibold text-gray-900 dark:text-gray-100"
          >
            {pending.title}
          </h2>
          <div id={descriptionId}>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{pending.message}</p>
            {pending.details && (
              <div className="mt-3 text-sm text-gray-700 dark:text-gray-300">
                {pending.details}
              </div>
            )}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => settle(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              autoFocus
              className={pending.danger ? destructiveButtonClass : primaryButtonClass}
              onClick={() => settle(true)}
            >
              {pending.confirmLabel ?? (pending.danger ? "Delete" : "Confirm")}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );

  return { confirm, dialog };
}
