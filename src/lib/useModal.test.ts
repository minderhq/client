import { afterEach, describe, expect, it } from "vitest";

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
