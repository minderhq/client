/** Makes everything outside the top-most open modal `inert`.
 *
 * A modal portals its root into `document.body` and registers that root here
 * while it is open. Every other child of <body> (the app's #root, and any
 * lower modal) gets the `inert` attribute, so it can't be clicked, focused or
 * reached by a screen reader. Closing the top modal hands that role to the one
 * below it; closing the last one restores the page.
 *
 * Only `inert` attributes added here are removed again: an element that was
 * already inert for another reason stays inert. */

const layers: HTMLElement[] = [];
const inertedHere = new Set<Element>();

/** The child of <body> that contains `el` (or `el` itself). */
function bodyChildOf(el: HTMLElement): HTMLElement {
  let node = el;
  while (node.parentElement && node.parentElement !== document.body) {
    node = node.parentElement;
  }
  return node;
}

function sync() {
  const top = layers.at(-1);
  if (!top) {
    for (const el of inertedHere) el.removeAttribute("inert");
    inertedHere.clear();
    return;
  }
  for (const el of Array.from(document.body.children)) {
    if (el === top) {
      if (inertedHere.delete(el)) el.removeAttribute("inert");
    } else if (!el.hasAttribute("inert")) {
      el.setAttribute("inert", "");
      inertedHere.add(el);
    }
  }
}

/** Register `el` (an open modal's root, portalled into <body>) as the top
 * layer. Returns a release function; calling it more than once is a no-op, so
 * it is safe to call from both an explicit close and an effect cleanup. */
export function pushModalLayer(el: HTMLElement): () => void {
  const layer = bodyChildOf(el);
  layers.push(layer);
  sync();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const index = layers.lastIndexOf(layer);
    if (index !== -1) layers.splice(index, 1);
    sync();
  };
}
