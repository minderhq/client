import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandPalette } from "./CommandPalette";
import { useConfirm } from "./ConfirmDialog";

let mockAuth = { role: "", sessionKey: "" };
vi.mock("../lib/auth", () => ({ useAuth: () => mockAuth }));

let mockBilling = true;
vi.mock("../lib/useBillingAccess", () => ({ useBillingAccess: () => mockBilling }));

// One stable ref, like the real hook (a fresh object per render would re-run
// the palette's search effect forever).
const tokenRef = { current: "" };
vi.mock("../lib/useTokenRef", () => ({ useTokenRef: () => tokenRef }));

// Live resource search is out of scope here; keep it from hitting the network.
vi.mock("../lib/api", () => ({ apiFetch: vi.fn().mockResolvedValue({ items: [], plugins: [] }) }));

// jsdom has no layout, so no scrollIntoView (the palette keeps the active row
// in view with it).
Element.prototype.scrollIntoView = () => {};

let pathname = "";
function Probe() {
  pathname = useLocation().pathname;
  return null;
}

function open() {
  render(
    <MemoryRouter>
      <CommandPalette open onClose={() => {}} />
      <Probe />
    </MemoryRouter>,
  );
}

function search(q: string) {
  fireEvent.change(screen.getByRole("combobox"), { target: { value: q } });
}

function resultLabels(): string[] {
  return screen
    .getAllByRole("option")
    .map((o) => o.querySelector("span.block.truncate")?.textContent ?? "");
}

describe("CommandPalette — marketplace entries (#2197)", () => {
  beforeEach(() => {
    mockAuth = { role: "", sessionKey: "" };
    mockBilling = true;
  });
  afterEach(cleanup);

  it("lists the marketplace pages by their page titles", () => {
    open();
    search("plugins");
    expect(resultLabels()).toEqual(
      expect.arrayContaining(["Discover plugins", "Installed plugins", "Plugin submissions"]),
    );
    expect(resultLabels()).not.toContain("Plugins: Browse");
  });

  it("finds AI tools and service bundles under both Discover and Installed", () => {
    open();
    search("ai tools");
    expect(resultLabels()).toEqual(expect.arrayContaining(["Discover AI tools", "Installed AI tools"]));
    search("bundles");
    expect(resultLabels()).toEqual(
      expect.arrayContaining(["Discover service bundles", "Installed service bundles"]),
    );
  });

  it("navigates to the new route", () => {
    open();
    search("discover plugins");
    fireEvent.click(screen.getByText("Discover plugins"));
    expect(pathname).toBe("/marketplace/discover/plugins");
  });

  it("offers MindHub & sources and Submission review to admins only", () => {
    open();
    search("mindhub");
    expect(screen.queryByText("MindHub & sources")).toBeNull();
    search("review queue");
    expect(screen.queryByText("Submission review")).toBeNull();
    cleanup();

    mockAuth = { role: "admin", sessionKey: "" };
    open();
    search("mindhub");
    expect(screen.getByText("MindHub & sources")).toBeTruthy();
    search("review queue");
    expect(screen.getByText("Submission review")).toBeTruthy();
  });

  it("hides Billing without billing access but keeps Plugin licenses", () => {
    mockBilling = false;
    open();
    search("billing");
    expect(resultLabels()).not.toContain("Billing");
    expect(resultLabels()).toContain("Plugin licenses");
  });
});

/** A page with a trigger that opens the palette, as App wires it, plus a
 * confirm dialog that can be opened while the palette is up. */
function Page({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const { confirm, dialog } = useConfirm();
  return (
    <main>
      <h1>Home</h1>
      {dialog}
      <button onClick={() => setOpen(true)}>Open palette</button>
      <button onClick={() => confirm({ title: "Sure?", message: "Really." })}>Ask</button>
      <CommandPalette
        open={open}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
      />
    </main>
  );
}

function renderPage(onClose?: () => void, { path = "/", strict = false } = {}) {
  const tree = (
    <MemoryRouter initialEntries={[path]}>
      <Page onClose={onClose} />
      <Probe />
    </MemoryRouter>
  );
  const view = render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  const trigger = screen.getByRole("button", { name: "Open palette" });
  return { ...view, trigger };
}

/** A full press (down, up, click) on `el`. */
function press(el: HTMLElement) {
  fireEvent.mouseDown(el);
  fireEvent.mouseUp(el);
  fireEvent.click(el);
}

function openFromTrigger(trigger: HTMLElement) {
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Command palette" });
  return { dialog, layer: dialog.parentElement! };
}

describe("CommandPalette — shared modal layer (#97)", () => {
  beforeEach(() => {
    mockAuth = { role: "", sessionKey: "" };
    mockBilling = true;
  });
  afterEach(cleanup);

  it("renders into <body>, outside the page, and makes the page inert while open", () => {
    const { container, trigger } = renderPage();
    const { dialog, layer } = openFromTrigger(trigger);

    expect(layer.parentElement).toBe(document.body);
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(container.hasAttribute("inert")).toBe(true);
    expect(layer.hasAttribute("inert")).toBe(false);

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(container.hasAttribute("inert")).toBe(false);
  });

  it("focuses the search field when it opens", () => {
    const { trigger } = renderPage();
    openFromTrigger(trigger);
    expect(document.activeElement).toBe(screen.getByRole("combobox"));
  });

  it("keeps its combobox/listbox semantics and arrow/Enter navigation", () => {
    const { trigger } = renderPage();
    openFromTrigger(trigger);
    const input = screen.getByRole("combobox");
    const listbox = screen.getByRole("listbox");
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);

    search("discover plugins");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(screen.getAllByRole("option")[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("traps Tab and Shift+Tab inside the palette", () => {
    const { trigger } = renderPage();
    const { layer } = openFromTrigger(trigger);
    const input = screen.getByRole("combobox");
    const options = within(screen.getByRole("listbox")).getAllByRole("button");
    const lastOption = options[options.length - 1];

    lastOption.focus();
    fireEvent.keyDown(layer, { key: "Tab" });
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(lastOption);
  });

  for (const [how, close] of [
    ["Escape in the search field", () => fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" })],
    [
      "Escape on a result",
      () => fireEvent.keyDown(within(screen.getByRole("listbox")).getAllByRole("button")[0], { key: "Escape" }),
    ],
    ["a press outside the panel", () => press(screen.getByRole("dialog").parentElement!)],
    ["running an action", () => {
      search("toggle theme");
      fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    }],
  ] as const) {
    it(`closes once on ${how} and returns focus to the trigger`, () => {
      const onClose = vi.fn();
      const { trigger } = renderPage(onClose);
      openFromTrigger(trigger);
      expect(document.activeElement).not.toBe(trigger);

      close();

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(trigger);
    });
  }

  it("returns focus to the trigger when a selection stays on the same page", () => {
    const { trigger } = renderPage(undefined, { path: "/ask" });
    openFromTrigger(trigger);
    search("ask a question");
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(pathname).toBe("/ask");
    expect(document.activeElement).toBe(trigger);
  });

  it("does not return focus to the trigger when a selection goes to another page", () => {
    const { container, trigger } = renderPage();
    openFromTrigger(trigger);
    const focusedTrigger = vi.fn();
    trigger.addEventListener("focus", focusedTrigger);
    search("discover plugins");
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(pathname).not.toBe("/");
    // The new page's heading takes it (lib/useRouteFocus.ts, covered in
    // App.test.tsx); the palette itself must not bounce it to the trigger.
    expect(focusedTrigger).not.toHaveBeenCalled();
    expect(container.hasAttribute("inert")).toBe(false);
  });

  it("opens and closes cleanly under StrictMode: focus in, focus back, no inert left", () => {
    const { container, trigger } = renderPage(undefined, { strict: true });
    const { layer } = openFromTrigger(trigger);
    expect(document.activeElement).toBe(screen.getByRole("combobox"));
    expect(container.hasAttribute("inert")).toBe(true);
    expect(layer.hasAttribute("inert")).toBe(false);

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.querySelectorAll("[inert]")).toHaveLength(0);

    // And again: the second session starts from scratch.
    openFromTrigger(trigger);
    expect(container.hasAttribute("inert")).toBe(true);
    press(screen.getByRole("dialog").parentElement!);
    expect(document.activeElement).toBe(trigger);
    expect(document.querySelectorAll("[inert]")).toHaveLength(0);
  });

  it("keeps focus in the search field while a press outside is down, then closes on release", () => {
    const { trigger } = renderPage();
    const { layer } = openFromTrigger(trigger);
    const input = screen.getByRole("combobox");

    expect(fireEvent.mouseDown(layer)).toBe(false); // default prevented: no blur
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(document.activeElement).toBe(input);

    fireEvent.mouseUp(layer);
    fireEvent.click(layer);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("stays open when a press crosses the panel edge, either way", () => {
    const { trigger } = renderPage();
    const { dialog, layer } = openFromTrigger(trigger);
    const input = screen.getByRole("combobox");

    // Starts outside, ends in the panel: the click lands on the layer.
    fireEvent.mouseDown(layer);
    fireEvent.mouseUp(input);
    fireEvent.click(layer);
    expect(screen.getByRole("dialog")).toBe(dialog);

    // Starts in the panel (selecting the query), ends outside.
    fireEvent.mouseDown(input);
    fireEvent.mouseUp(layer);
    fireEvent.click(layer);
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(document.activeElement).toBe(input);
  });

  it("returns focus to the pressed trigger when the click didn't focus it (Safari)", () => {
    const { trigger } = renderPage();
    const inner = document.createElement("span");
    trigger.appendChild(inner);
    fireEvent.pointerDown(inner);
    fireEvent.click(trigger);
    expect(document.activeElement).not.toBe(trigger);

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });

    expect(document.activeElement).toBe(trigger);
  });

  it("falls back to the page heading when there is nothing to return focus to", () => {
    const { trigger } = renderPage();
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.click(trigger);

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });

    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Home" }));
  });

  it("gives each instance its own listbox id", () => {
    render(
      <MemoryRouter>
        <CommandPalette open onClose={() => {}} />
        <CommandPalette open onClose={() => {}} />
      </MemoryRouter>,
    );
    const ids = screen.getAllByRole("listbox").map((l) => l.id);
    expect(ids[0]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
    const controls = screen.getAllByRole("combobox").map((c) => c.getAttribute("aria-controls"));
    expect(controls).toEqual(ids);
  });

  it("stacks under a confirm dialog opened on top, and gets interactivity back after", async () => {
    const { container, trigger } = renderPage();
    const { layer: paletteLayer } = openFromTrigger(trigger);
    const input = screen.getByRole("combobox");

    // The page is inert, but a test can still dispatch the click.
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    const confirmDialog = await screen.findByRole("alertdialog");
    const confirmLayer = confirmDialog.parentElement!;

    expect(confirmLayer.parentElement).toBe(document.body);
    expect(paletteLayer.compareDocumentPosition(confirmLayer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.hasAttribute("inert")).toBe(true);
    expect(paletteLayer.hasAttribute("inert")).toBe(true);
    expect(confirmLayer.hasAttribute("inert")).toBe(false);

    expect(document.activeElement).toBe(within(confirmDialog).getByRole("button", { name: "Confirm" }));
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Cancel" }));

    expect(paletteLayer.hasAttribute("inert")).toBe(false);
    expect(container.hasAttribute("inert")).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(input));

    fireEvent.keyDown(input, { key: "Escape" });
    expect(container.hasAttribute("inert")).toBe(false);
  });
});
