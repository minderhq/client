import { type ReactNode, useId } from "react";
import { createPortal } from "react-dom";

import type { Modal } from "../lib/useModal";

/** The standard centred modal dialog: a backdrop covering the whole viewport,
 * portalled into <body> so no transformed ancestor can trap it, and a panel
 * labelled by its title and described by `description`. Behaviour (inert
 * page, focus in/trap/return, Escape, backdrop click) comes from `modal`, the
 * owner's `useModal()`; render this only while the modal is open. */
export function Dialog({
  modal,
  role = "dialog",
  title,
  description,
  widthClass = "max-w-md",
  children,
}: {
  modal: Modal;
  /** "alertdialog" for confirmations that interrupt, "dialog" otherwise. */
  role?: "dialog" | "alertdialog";
  title: ReactNode;
  /** Read out with the title when the dialog opens (aria-describedby). */
  description: ReactNode;
  widthClass?: string;
  children?: ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();
  return createPortal(
    <div
      ref={modal.layerRef}
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onKeyDown={modal.onKeyDown}
      {...modal.backdropProps}
    >
      <div
        ref={modal.panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className={`w-full ${widthClass} rounded-xl bg-white p-5 shadow-xl dark:bg-gray-900`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-base font-semibold text-gray-900 dark:text-gray-100">
          {title}
        </h2>
        <div id={descriptionId}>{description}</div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
