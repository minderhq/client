/** Makes everything outside the top-most open modal `inert`.
 *
 * A modal portals its root into `document.body` and registers that root here
 * while it is open. Every other child of <body> (the app's #root, and any
 * lower modal) gets the `inert` attribute, so it can't be clicked, focused or
 * reached by a screen reader. Closing the top modal hands that role to the one
 * below it; closing the last one restores the page.
 *
 * Only `inert` this module added is ever removed again. An element that was
 * already inert stays inert, and so does one whose `inert` another script
 * (re)writes while a modal is open: a MutationObserver sees that write and
 * hands ownership of the attribute to that script. */

const layers: HTMLElement[] = [];
/** Elements whose `inert` attribute this module added and still owns. */
const inertedHere = new Set<Element>();
/** Layers that have been released but may still be in the DOM until React
 * commits their removal; never re-inerted. */
const released = new WeakSet<Element>();
/** Watches `inert` writes while any layer is open (see the module comment). */
let observer: MutationObserver | null = null;

/** The child of <body> that contains `el` (or `el` itself). */
function bodyChildOf(el: HTMLElement): HTMLElement {
  let node = el;
  while (node.parentElement && node.parentElement !== document.body) {
    node = node.parentElement;
  }
  return node;
}

/** Someone else wrote `inert` on an element we inerted: it's theirs now. Our
 * own writes never get here -- sync() discards them with takeRecords(). */
function disown(records: MutationRecord[]) {
  for (const record of records) inertedHere.delete(record.target as Element);
}

function sync() {
  if (observer) disown(observer.takeRecords());
  // Forget elements that have left <body> (a closed lower layer's backdrop).
  for (const el of inertedHere) {
    if (el.parentElement !== document.body) inertedHere.delete(el);
  }

  const top = layers.at(-1);
  if (!top) {
    for (const el of inertedHere) el.removeAttribute("inert");
    inertedHere.clear();
    observer?.disconnect();
    observer = null;
    return;
  }

  if (!observer) {
    observer = new MutationObserver(disown);
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["inert"],
    });
  }
  for (const el of Array.from(document.body.children)) {
    if (el === top) {
      if (inertedHere.delete(el)) el.removeAttribute("inert");
    } else if (!released.has(el) && !el.hasAttribute("inert")) {
      el.setAttribute("inert", "");
      inertedHere.add(el);
    }
  }
  observer.takeRecords(); // drop the records of the writes just made
}

/** Register `el` (an open modal's root, portalled into <body>) as the top
 * layer. Returns a release function; calling it more than once is a no-op, so
 * it is safe to call from both an explicit close and an effect cleanup. */
export function pushModalLayer(el: HTMLElement): () => void {
  const layer = bodyChildOf(el);
  released.delete(layer);
  layers.push(layer);
  sync();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const index = layers.lastIndexOf(layer);
    if (index !== -1) layers.splice(index, 1);
    released.add(layer);
    // A lower layer closed under an open one was inerted by us: let go now
    // rather than leaving it tracked once React detaches it.
    if (observer) disown(observer.takeRecords());
    if (inertedHere.delete(layer)) layer.removeAttribute("inert");
    sync();
  };
}

/** Whether any modal layer is open -- e.g. so a global shortcut can stand
 * down while a dialog owns the keyboard. */
export function isModalOpen(): boolean {
  return layers.length > 0;
}
