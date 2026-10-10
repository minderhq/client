import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useConfirm } from "./ConfirmDialog";

function Harness({
  danger,
  confirmLabel,
}: {
  danger?: boolean;
  confirmLabel?: string;
}) {
  const { confirm, dialog } = useConfirm();
  return (
    <>
      {dialog}
      <button
        onClick={async () => {
          const result = await confirm({
            title: "Delete thing?",
            message: "This cannot be undone.",
            danger,
            confirmLabel,
          });
          document.title = `result:${result}`;
        }}
      >
        Trigger
      </button>
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.title = "";
});

/** How many times `method` wrote the `inert` attribute on `el`. */
function inertWrites(spy: { mock: { calls: unknown[][]; contexts: unknown[] } }, el: Element) {
  return spy.mock.calls.filter((args, i) => args[0] === "inert" && spy.mock.contexts[i] === el)
    .length;
}

describe("useConfirm", () => {
  it("renders no dialog until confirm() is called", () => {
    render(<Harness />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("shows the dialog with the given title/message on confirm()", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Trigger"));

    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText("Delete thing?")).toBeTruthy();
    expect(screen.getByText("This cannot be undone.")).toBeTruthy();
  });

  it("resolves true and closes the dialog when the confirm button is clicked", async () => {
    render(<Harness danger />);
    fireEvent.click(screen.getByText("Trigger"));
    await screen.findByRole("alertdialog");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(document.title).toBe("result:true"));
  });

  it("resolves false when Cancel is clicked", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Trigger"));
    await screen.findByRole("alertdialog");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(document.title).toBe("result:false"));
  });

  it("resolves false when the backdrop is clicked", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Trigger"));
    const backdrop = await screen.findByRole("presentation");

    fireEvent.click(backdrop);

    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(document.title).toBe("result:false"));
  });

  it("does not dismiss when the panel itself is clicked (stopPropagation)", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Trigger"));
    const panel = await screen.findByRole("alertdialog");

    fireEvent.click(panel);

    expect(screen.queryByRole("alertdialog")).toBeTruthy();
    expect(document.title).toBe("");
  });

  it("resolves false on Escape", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Trigger"));
    const backdrop = await screen.findByRole("presentation");

    fireEvent.keyDown(backdrop, { key: "Escape" });

    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(document.title).toBe("result:false"));
  });

  it("defaults to a 'Confirm' button for non-danger confirmations", async () => {
    render(<Harness danger={false} />);
    fireEvent.click(screen.getByText("Trigger"));
    expect(await screen.findByRole("button", { name: "Confirm" })).toBeTruthy();
  });

  it("uses a custom confirmLabel when provided, overriding the danger default", async () => {
    render(<Harness danger confirmLabel="Reconcile now" />);
    fireEvent.click(screen.getByText("Trigger"));
    expect(
      await screen.findByRole("button", { name: "Reconcile now" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("traps Tab from the last button back to the first", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Trigger"));
    const backdrop = await screen.findByRole("presentation");
    const confirmButton = screen.getByRole("button", { name: "Confirm" });
    const cancelButton = screen.getByRole("button", { name: "Cancel" });

    confirmButton.focus();
    expect(document.activeElement).toBe(confirmButton);
    fireEvent.keyDown(backdrop, { key: "Tab" });

    expect(document.activeElement).toBe(cancelButton);
  });

  it("traps Shift+Tab from the first button back to the last", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Trigger"));
    const backdrop = await screen.findByRole("presentation");
    const confirmButton = screen.getByRole("button", { name: "Confirm" });
    const cancelButton = screen.getByRole("button", { name: "Cancel" });

    cancelButton.focus();
    expect(document.activeElement).toBe(cancelButton);
    fireEvent.keyDown(backdrop, { key: "Tab", shiftKey: true });

    expect(document.activeElement).toBe(confirmButton);
  });
  it("renders structured details and describes the dialog with message + details", async () => {
    function DetailsHarness() {
      const { confirm, dialog } = useConfirm();
      return (
        <>
          {dialog}
          <button
            onClick={() =>
              confirm({
                title: "Apply import?",
                message: "These changes will be applied.",
                details: (
                  <ul>
                    <li>Enable rag</li>
                  </ul>
                ),
              })
            }
          >
            Open
          </button>
        </>
      );
    }
    render(<DetailsHarness />);
    fireEvent.click(screen.getByText("Open"));

    const dialog = await screen.findByRole("alertdialog");
    const description = document.getElementById(dialog.getAttribute("aria-describedby")!)!;
    expect(description.textContent).toBe("These changes will be applied.Enable rag");
    expect(screen.getByRole("listitem").textContent).toBe("Enable rag");
  });

  it("describes the dialog with just the message when there are no details", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Trigger"));

    const dialog = await screen.findByRole("alertdialog");
    const describedBy = dialog.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)!.textContent).toBe("This cannot be undone.");
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(document.getElementById(labelledBy!)!.textContent).toBe("Delete thing?");
  });

  it("focuses the confirm button when it opens", async () => {
    render(<Harness danger confirmLabel="Uninstall" />);
    fireEvent.click(screen.getByText("Trigger"));
    await screen.findByRole("alertdialog");

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Uninstall" }));
  });
});

/** Two independent confirm dialogs, as two components on one page would
 * have. `nested` opens the second from inside the first. */
function TwoDialogs() {
  const first = useConfirm();
  const second = useConfirm();
  return (
    <>
      {first.dialog}
      {second.dialog}
      <button
        onClick={async () => {
          document.title = `first:${await first.confirm({ title: "First?", message: "First message." })}`;
        }}
      >
        Open first
      </button>
      <button
        onClick={async () => {
          document.title = `second:${await second.confirm({ title: "Second?", message: "Second message." })}`;
        }}
      >
        Open second
      </button>
    </>
  );
}

/** Opens a dialog, then (on "Remove") unmounts the component that owns it
 * without the dialog ever being closed. */
function UnmountHarness() {
  const [shown, setShown] = useState(true);
  return (
    <>
      <button onClick={() => setShown(false)}>Remove</button>
      {shown && <Harness />}
    </>
  );
}

function backdropOf(dialog: HTMLElement): HTMLElement {
  return dialog.parentElement!;
}

describe("useConfirm portal", () => {
  it("renders the dialog as a child of <body>, outside the page that asked", async () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByText("Trigger"));

    const dialog = await screen.findByRole("alertdialog");
    expect(backdropOf(dialog).parentElement).toBe(document.body);
    expect(container.contains(dialog)).toBe(false);
  });

  it("gives each open dialog its own title and description ids", async () => {
    render(<TwoDialogs />);
    fireEvent.click(screen.getByText("Open first"));
    fireEvent.click(screen.getByText("Open second"));

    const dialogs = await screen.findAllByRole("alertdialog");
    expect(dialogs).toHaveLength(2);
    const [a, b] = dialogs;
    expect(a.getAttribute("aria-labelledby")).not.toBe(b.getAttribute("aria-labelledby"));
    expect(a.getAttribute("aria-describedby")).not.toBe(b.getAttribute("aria-describedby"));
    for (const [dialog, title, message] of [
      [a, "First?", "First message."],
      [b, "Second?", "Second message."],
    ] as const) {
      const titleEl = document.getElementById(dialog.getAttribute("aria-labelledby")!)!;
      const messageEl = document.getElementById(dialog.getAttribute("aria-describedby")!)!;
      expect(titleEl.textContent).toBe(title);
      expect(messageEl.textContent).toBe(message);
      expect(dialog.contains(titleEl) && dialog.contains(messageEl)).toBe(true);
    }
  });
});

describe("useConfirm inert", () => {
  it("makes the page inert while open and restores it on close", async () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByText("Trigger"));
    const dialog = await screen.findByRole("alertdialog");

    expect(container.hasAttribute("inert")).toBe(true);
    expect(backdropOf(dialog).hasAttribute("inert")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(container.hasAttribute("inert")).toBe(false);
  });

  it("restores the page when the owner unmounts with the dialog still open", async () => {
    const { container } = render(<UnmountHarness />);
    fireEvent.click(screen.getByText("Trigger"));
    await screen.findByRole("alertdialog");
    expect(container.hasAttribute("inert")).toBe(true);

    // The page is inert, but a test can still dispatch the click.
    fireEvent.click(screen.getByText("Remove"));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(container.hasAttribute("inert")).toBe(false);
  });

  it("applies and removes inert exactly once under StrictMode", async () => {
    const set = vi.spyOn(Element.prototype, "setAttribute");
    const remove = vi.spyOn(Element.prototype, "removeAttribute");
    const { container } = render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    fireEvent.click(screen.getByText("Trigger"));
    await screen.findByRole("alertdialog");
    expect(container.hasAttribute("inert")).toBe(true);
    expect(inertWrites(set, container)).toBe(1);
    expect(inertWrites(remove, container)).toBe(0);

    fireEvent.keyDown(screen.getByRole("presentation"), { key: "Escape" });

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(container.hasAttribute("inert")).toBe(false);
    expect(inertWrites(set, container)).toBe(1);
    expect(inertWrites(remove, container)).toBe(1);
    await waitFor(() => expect(document.title).toBe("result:false"));
  });

  it("lets go of a lower dialog closed under an open one at once (out-of-order close)", async () => {
    const { container } = render(<TwoDialogs />);
    fireEvent.click(screen.getByText("Open first"));
    const first = await screen.findByRole("alertdialog");
    const firstBackdrop = backdropOf(first);
    fireEvent.click(screen.getByText("Open second"));
    const second = screen.getAllByRole("alertdialog").find((d) => d !== first)!;
    expect(firstBackdrop.hasAttribute("inert")).toBe(true);

    // Close the LOWER one first (a test can click through inert).
    fireEvent.click(within(first).getByRole("button", { name: "Cancel" }));

    expect(firstBackdrop.isConnected).toBe(false);
    expect(firstBackdrop.hasAttribute("inert")).toBe(false);
    expect(container.hasAttribute("inert")).toBe(true);
    expect(backdropOf(second).hasAttribute("inert")).toBe(false);

    fireEvent.click(within(second).getByRole("button", { name: "Cancel" }));
    expect(container.hasAttribute("inert")).toBe(false);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("keeps a dialog stacked above on top when the one below gets a new request", async () => {
    render(<TwoDialogs />);
    fireEvent.click(screen.getByText("Open first"));
    const first = await screen.findByRole("alertdialog", { name: "First?" });
    // The page is inert, but a test can still dispatch the clicks.
    fireEvent.click(screen.getByText("Open second"));
    const second = await screen.findByRole("alertdialog", { name: "Second?" });
    const secondConfirm = within(second).getByRole("button", { name: "Confirm" });
    expect(document.activeElement).toBe(secondConfirm);

    // A new request replaces the lower dialog's content in place.
    fireEvent.click(screen.getByText("Open first"));
    expect(screen.getByRole("alertdialog", { name: "First?" })).toBe(first);

    expect(second.parentElement!.hasAttribute("inert")).toBe(false);
    expect(first.parentElement!.hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(secondConfirm);

    // Closing the top one hands interactivity back to the one below.
    fireEvent.click(within(second).getByRole("button", { name: "Cancel" }));
    expect(first.parentElement!.hasAttribute("inert")).toBe(false);
  });

  it("leaves inert that other code sets while a dialog is open", async () => {
    const { container } = render(<Harness />);
    const late = document.createElement("div");
    try {
      fireEvent.click(screen.getByText("Trigger"));
      await screen.findByRole("alertdialog");

      // Other code inerts the page itself (already inert by us) and an
      // element added while the dialog is open.
      container.setAttribute("inert", "");
      document.body.appendChild(late);
      late.setAttribute("inert", "");

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(container.hasAttribute("inert")).toBe(true);
      expect(late.hasAttribute("inert")).toBe(true);
    } finally {
      container.removeAttribute("inert");
      late.remove();
    }
  });

  it("keeps only the top dialog interactive when two are open", async () => {
    const { container } = render(<TwoDialogs />);
    fireEvent.click(screen.getByText("Open first"));
    const first = await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByText("Open second"));
    const second = screen.getAllByRole("alertdialog").find((d) => d !== first)!;

    expect(container.hasAttribute("inert")).toBe(true);
    expect(backdropOf(first).hasAttribute("inert")).toBe(true);
    expect(backdropOf(second).hasAttribute("inert")).toBe(false);

    // Closing the top one hands interactivity back to the one below.
    fireEvent.click(within(second).getByRole("button", { name: "Cancel" }));
    expect(backdropOf(first).hasAttribute("inert")).toBe(false);
    expect(container.hasAttribute("inert")).toBe(true);

    fireEvent.click(within(first).getByRole("button", { name: "Confirm" }));
    expect(container.hasAttribute("inert")).toBe(false);
    await waitFor(() => expect(document.title).toBe("first:true"));
  });

  it("leaves an element that was already inert inert", async () => {
    const other = document.createElement("div");
    other.setAttribute("inert", "");
    document.body.appendChild(other);
    try {
      render(<Harness />);
      fireEvent.click(screen.getByText("Trigger"));
      await screen.findByRole("alertdialog");
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(other.hasAttribute("inert")).toBe(true);
    } finally {
      other.remove();
    }
  });
});

/** A trigger that disappears, or is disabled, while its dialog is open --
 * e.g. a row removed by a refresh, or the bundle import's busy file input. */
function VanishingTrigger({ mode }: { mode: "removed" | "disabled" }) {
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  return (
    <main>
      <h1>Bundles</h1>
      {dialog}
      {!(mode === "removed" && busy) && (
        <button
          disabled={mode === "disabled" && busy}
          onClick={async () => {
            setBusy(true);
            await confirm({ title: "Go?", message: "Really." });
          }}
        >
          Trigger
        </button>
      )}
    </main>
  );
}

describe("useConfirm focus return", () => {
  for (const [how, close] of [
    ["Cancel", () => fireEvent.click(screen.getByRole("button", { name: "Cancel" }))],
    ["confirm", () => fireEvent.click(screen.getByRole("button", { name: "Confirm" }))],
    ["Escape", () => fireEvent.keyDown(screen.getByRole("presentation"), { key: "Escape" })],
    ["backdrop click", () => fireEvent.click(screen.getByRole("presentation"))],
  ] as const) {
    it(`returns focus to the trigger after ${how}`, async () => {
      render(<Harness />);
      const trigger = screen.getByText("Trigger");
      trigger.focus();
      fireEvent.click(trigger);
      await screen.findByRole("alertdialog");
      expect(document.activeElement).not.toBe(trigger);

      close();

      expect(document.activeElement).toBe(trigger);
    });
  }

  it("returns focus before the promise resolves, so the caller can move it after", async () => {
    function MovesFocus() {
      const { confirm, dialog } = useConfirm();
      return (
        <>
          {dialog}
          <button
            onClick={async () => {
              await confirm({ title: "Go?", message: "Really." });
              document.getElementById("elsewhere")!.focus();
            }}
          >
            Trigger
          </button>
          <input id="elsewhere" aria-label="Elsewhere" />
        </>
      );
    }
    render(<MovesFocus />);
    const trigger = screen.getByText("Trigger");
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole("alertdialog");

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText("Elsewhere")),
    );
  });

  it("gives a confirm chained straight after another a session of its own", async () => {
    function Chained() {
      const { confirm, dialog } = useConfirm();
      return (
        <main>
          <h1>Page</h1>
          {dialog}
          <button
            onClick={async () => {
              if (!(await confirm({ title: "First?", message: "One." }))) return;
              await confirm({ title: "Second?", message: "Two." });
            }}
          >
            Trigger
          </button>
        </main>
      );
    }
    const { container } = render(<Chained />);
    const trigger = screen.getByText("Trigger");
    trigger.focus();
    fireEvent.click(trigger);
    const first = await screen.findByRole("alertdialog", { name: "First?" });

    // The second request is made from the first one's await continuation, so
    // React renders the close and the reopen as one update.
    await act(async () => {
      fireEvent.click(within(first).getByRole("button", { name: "Confirm" }));
    });
    const second = screen.getByRole("alertdialog", { name: "Second?" });

    expect(container.hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(within(second).getByRole("button", { name: "Confirm" }));

    fireEvent.click(within(second).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(container.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  for (const mode of ["removed", "disabled"] as const) {
    it(`falls back to the page heading when the trigger was ${mode}`, async () => {
      render(<VanishingTrigger mode={mode} />);
      const trigger = screen.getByText("Trigger");
      trigger.focus();
      fireEvent.click(trigger);
      await screen.findByRole("alertdialog");

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      const heading = screen.getByRole("heading", { name: "Bundles" });
      expect(document.activeElement).toBe(heading);
      expect(heading.getAttribute("tabindex")).toBe("-1");
    });
  }

  it("returns focus to the pressed button when the click didn't focus it (Safari)", async () => {
    render(<Harness />);
    const trigger = screen.getByText("Trigger");
    const inner = document.createElement("span");
    trigger.appendChild(inner);
    // Safari / macOS Firefox: pointerdown + click, but the button never takes
    // focus, so activeElement is <body> when confirm() runs.
    fireEvent.pointerDown(inner);
    fireEvent.click(trigger);
    expect(document.activeElement).not.toBe(trigger);
    await screen.findByRole("alertdialog");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(document.activeElement).toBe(trigger);
  });

  it("installs one pair of tracking listeners for any number of dialogs and removes them", () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const count = (spy: typeof add) =>
      spy.mock.calls.filter(([type]) => type === "pointerdown" || type === "focusin").length;

    const { unmount } = render(<TwoDialogs />);
    expect(count(add)).toBe(2);
    expect(count(remove)).toBe(0);

    unmount();
    expect(count(remove)).toBe(2);
  });

  it("does not move focus when the owner unmounts with the dialog open", async () => {
    render(<UnmountHarness />);
    const trigger = screen.getByText("Trigger");
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole("alertdialog");
    const remove = screen.getByText("Remove");
    remove.focus();

    fireEvent.click(remove);

    expect(document.activeElement).toBe(remove);
  });
});
