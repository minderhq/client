import { afterEach, describe, expect, it, vi } from "vitest";

import { isModalOpen, pushModalLayer } from "./modalLayer";
import { tabbableIn } from "./useModal";

afterEach(() => {
  document.body.innerHTML = "";
});

function fixture(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe("tabbableIn", () => {
  it("lists what Tab reaches, in document order", () => {
    const el = fixture(`
      <a href="#a">link</a>
      <a>no href</a>
      <button>enabled</button>
      <button disabled>disabled</button>
      <input type="hidden" />
      <input aria-label="text" />
      <div tabindex="0">focusable div</div>
      <div tabindex="-1">programmatic only</div>
      <button tabindex="-1">skipped</button>
      <div hidden><button>hidden</button></div>
      <fieldset disabled><input aria-label="in disabled fieldset" /></fieldset>
      <textarea aria-label="area"></textarea>
    `);
    expect(tabbableIn(el).map((n) => n.textContent || n.getAttribute("aria-label"))).toEqual([
      "link",
      "enabled",
      "text",
      "focusable div",
      "area",
    ]);
  });

  it("includes only the checked radio of a group that has one", () => {
    const el = fixture(`
      <input type="radio" name="g" aria-label="a" />
      <input type="radio" name="g" aria-label="b" checked />
      <input type="radio" name="h" aria-label="c" />
      <input type="radio" name="h" aria-label="d" />
    `);
    expect(tabbableIn(el).map((n) => n.getAttribute("aria-label"))).toEqual(["b", "c", "d"]);
  });
});

describe("tabbableIn — editable, collapsed and unrendered content", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (Element.prototype as Partial<Element>).checkVisibility;
  });

  const names = (els: HTMLElement[]) => els.map((n) => n.getAttribute("aria-label"));

  it("treats every editable contenteditable state as tabbable", () => {
    const el = fixture(`
      <div contenteditable="" aria-label="empty"></div>
      <div contenteditable="true" aria-label="true"></div>
      <div contenteditable="PLAINTEXT-ONLY" aria-label="plaintext"></div>
      <div contenteditable="false" aria-label="false"></div>
      <div aria-label="plain"></div>
    `);
    expect(names(tabbableIn(el))).toEqual(["empty", "true", "plaintext"]);
  });

  it("skips the content of a closed <details> but keeps its summary", () => {
    const el = fixture(`
      <details>
        <summary aria-label="closed summary">a</summary>
        <button aria-label="in closed"></button>
      </details>
      <details open>
        <summary aria-label="open summary">b</summary>
        <button aria-label="in open"></button>
        <details>
          <summary aria-label="nested closed summary">c</summary>
          <a href="#x" aria-label="in nested closed"></a>
        </details>
      </details>
      <details>
        <summary aria-label="outer closed summary">d</summary>
        <details open><summary aria-label="inside outer closed">e</summary></details>
      </details>
    `);
    expect(names(tabbableIn(el))).toEqual([
      "closed summary",
      "open summary",
      "in open",
      "nested closed summary",
      "outer closed summary",
    ]);
  });

  it("skips elements that aren't rendered, using checkVisibility where the browser has it", () => {
    const el = fixture(`
      <button aria-label="shown"></button>
      <button class="gone" aria-label="display none"></button>
    `);
    const checkVisibility = vi.fn(function (this: Element) {
      return !this.classList.contains("gone");
    });
    Object.defineProperty(Element.prototype, "checkVisibility", {
      value: checkVisibility,
      configurable: true,
      writable: true,
    });
    expect(names(tabbableIn(el))).toEqual(["shown"]);
    expect(checkVisibility).toHaveBeenCalledWith({ visibilityProperty: true, checkVisibilityCSS: true });
  });

  it("falls back to client rects when there is layout, and ignores them when there is none", () => {
    const el = fixture(`
      <button aria-label="shown"></button>
      <button class="gone" aria-label="display none"></button>
    `);
    // jsdom: no layout, so no element has a box -- don't call them all hidden.
    expect(names(tabbableIn(el))).toEqual(["shown", "display none"]);

    const box = [new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList;
    const none = [] as unknown as DOMRectList;
    vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (this: Element) {
      return this.classList.contains("gone") ? none : box;
    });
    expect(names(tabbableIn(el))).toEqual(["shown"]);
  });
});

describe("isModalOpen", () => {
  it("is true while any layer is open, through stacking and out-of-order close", () => {
    const a = fixture("");
    const b = fixture("");
    expect(isModalOpen()).toBe(false);
    const releaseA = pushModalLayer(a);
    const releaseB = pushModalLayer(b);
    expect(isModalOpen()).toBe(true);
    releaseA();
    expect(isModalOpen()).toBe(true);
    releaseB();
    expect(isModalOpen()).toBe(false);
  });
});
