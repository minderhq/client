/** The interactive element the user last pressed or moved focus to.
 *
 * Safari, and Firefox on macOS, don't focus a button when it is clicked, so at
 * the moment its click handler runs `document.activeElement` is <body> and
 * there is nothing to return focus to afterwards. A capture-phase
 * pointerdown/focusin listener records the interactive element under the
 * pointer (or receiving focus) instead.
 *
 * The listeners are installed while at least one caller is tracking and
 * removed with the last one; the element is held through a WeakRef, so a
 * removed node is never kept alive. */

const INTERACTIVE =
  'button, a[href], input, select, textarea, summary, [tabindex], [role="button"], [contenteditable="true"]';

let last: WeakRef<HTMLElement> | null = null;
let trackers = 0;

function record(event: Event) {
  const target = event.target instanceof Element ? event.target.closest(INTERACTIVE) : null;
  last = target instanceof HTMLElement ? new WeakRef(target) : null;
}

/** Start tracking; returns the matching stop function (idempotent). */
export function trackLastInteraction(): () => void {
  if (trackers++ === 0) {
    document.addEventListener("pointerdown", record, true);
    document.addEventListener("focusin", record, true);
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    if (--trackers === 0) {
      document.removeEventListener("pointerdown", record, true);
      document.removeEventListener("focusin", record, true);
      last = null;
    }
  };
}

/** The last pressed/focused interactive element, if it's still in the page. */
export function lastInteractedElement(): HTMLElement | null {
  const el = last?.deref();
  return el?.isConnected ? el : null;
}
