import { type ReactNode, useCallback, useState } from "react";

import { destructiveButtonClass, primaryButtonClass, secondaryButtonClass } from "../lib/ui";
import { useModal } from "../lib/useModal";
import { Dialog } from "./Dialog";

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
 * rest of the app is `inert` while it is open (see lib/useModal.ts and
 * lib/modalLayer.ts). On close, focus goes back to whatever had it when the
 * dialog opened (or, if that is gone or disabled, to the page's heading, as
 * after a navigation), before the returned promise resolves -- so a caller
 * that moves focus after the `await` still wins.
 */
export function useConfirm() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const modal = useModal({ open: pending !== null, onDismiss: () => settle(false) });

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...options, resolve });
      }),
    [],
  );

  function settle(result: boolean) {
    if (!pending) return;
    // Lift `inert` and put focus back before the caller's `await` resumes.
    modal.close();
    pending.resolve(result);
    setPending(null);
  }

  const dialog = pending && (
    <Dialog
      modal={modal}
      role="alertdialog"
      title={pending.title}
      widthClass={pending.details ? "max-w-md" : "max-w-sm"}
      description={
        <>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{pending.message}</p>
          {pending.details && (
            <div className="mt-3 text-sm text-gray-700 dark:text-gray-300">{pending.details}</div>
          )}
        </>
      }
    >
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className={secondaryButtonClass} onClick={() => settle(false)}>
          Cancel
        </button>
        <button
          type="button"
          data-autofocus
          className={pending.danger ? destructiveButtonClass : primaryButtonClass}
          onClick={() => settle(true)}
        >
          {pending.confirmLabel ?? (pending.danger ? "Delete" : "Confirm")}
        </button>
      </div>
    </Dialog>
  );

  return { confirm, dialog };
}
