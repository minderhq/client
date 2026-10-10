import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ResetPasswordControl } from "./ResetPasswordControl";

const apiFetch = vi.fn();
vi.mock("../lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  friendlyErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
}));

afterEach(() => {
  cleanup();
  apiFetch.mockReset();
});

function Page({ count = 1 }: { count?: number }) {
  return (
    <main>
      <h1>Users</h1>
      {Array.from({ length: count }, (_, i) => (
        <ResetPasswordControl
          key={i}
          username="alice"
          endpoint="/v1/auth/users/1/reset-password"
          token="tok"
        />
      ))}
    </main>
  );
}

/** Renders the control and opens its dialog from a focused trigger. */
function openDialog() {
  const view = render(<Page />);
  const trigger = screen.getByRole("button", { name: "Reset password" });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog");
  return { ...view, trigger, dialog, layer: dialog.parentElement! };
}

describe("ResetPasswordControl dialog (#97)", () => {
  it("renders into <body>, outside the page, as a labelled and described modal", () => {
    const { container, dialog, layer } = openDialog();

    expect(layer.parentElement).toBe(document.body);
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const title = document.getElementById(dialog.getAttribute("aria-labelledby")!)!;
    const description = document.getElementById(dialog.getAttribute("aria-describedby")!)!;
    expect(title.textContent).toBe("Reset password for alice?");
    expect(description.textContent).toMatch(/signs alice out everywhere/);
    expect(dialog.contains(title) && dialog.contains(description)).toBe(true);
  });

  it("makes the page inert while open and restores it on close", () => {
    const { container, layer, dialog } = openDialog();
    expect(container.hasAttribute("inert")).toBe(true);
    expect(layer.hasAttribute("inert")).toBe(false);

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(container.hasAttribute("inert")).toBe(false);
  });

  it("lifts inert when the control unmounts with the dialog open", () => {
    function Removable() {
      const [shown, setShown] = useState(true);
      return (
        <>
          <button onClick={() => setShown(false)}>Remove</button>
          {shown && <Page />}
        </>
      );
    }
    const { container } = render(<Removable />);
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    expect(container.hasAttribute("inert")).toBe(true);

    fireEvent.click(screen.getByText("Remove"));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(container.hasAttribute("inert")).toBe(false);
  });

  it("moves focus to the selected mode when it opens", () => {
    const { trigger } = openDialog();
    expect(document.activeElement).not.toBe(trigger);
    expect(document.activeElement).toBe(screen.getByLabelText("Generate a temporary password"));
  });

  it("traps Tab and Shift+Tab inside the dialog", () => {
    const { layer, dialog } = openDialog();
    const generate = within(dialog).getByLabelText("Generate a temporary password");
    const submit = within(dialog).getByRole("button", { name: "Reset password" });

    submit.focus();
    fireEvent.keyDown(layer, { key: "Tab" });
    expect(document.activeElement).toBe(generate);

    fireEvent.keyDown(layer, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(submit);
  });

  it("wraps Shift+Tab to the checked radio's group, not an unchecked radio", () => {
    const { layer, dialog } = openDialog();
    const set = within(dialog).getByLabelText("Set a password");
    fireEvent.click(set);
    const submit = within(dialog).getByRole("button", { name: "Reset password" });

    // "Set a password" is now the group's only Tab stop, and the first one.
    set.focus();
    fireEvent.keyDown(layer, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(submit);
    fireEvent.keyDown(layer, { key: "Tab" });
    expect(document.activeElement).toBe(set);
  });

  for (const [how, close] of [
    ["Cancel", (d: HTMLElement) => fireEvent.click(within(d).getByRole("button", { name: "Cancel" }))],
    ["Escape", (d: HTMLElement) => fireEvent.keyDown(d, { key: "Escape" })],
    ["a backdrop click", (d: HTMLElement) => fireEvent.click(d.parentElement!)],
  ] as const) {
    it(`closes on ${how} and returns focus to the trigger`, () => {
      const { trigger, dialog } = openDialog();

      close(dialog);

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(trigger);
      expect(apiFetch).not.toHaveBeenCalled();
    });
  }

  it("returns focus to the trigger after Done, and forgets the one-time password", async () => {
    apiFetch.mockResolvedValue({
      user_id: 1,
      mode: "generate",
      must_change_password: true,
      temporary_password: "Tmp-once-XYZ",
    });
    const { trigger, dialog } = openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset password" }));
    const done = await within(dialog).findByRole("button", { name: "Done" });

    // The description follows the dialog's state.
    const description = document.getElementById(dialog.getAttribute("aria-describedby")!)!;
    expect(description.textContent).toMatch(/password was reset/);
    expect(document.activeElement).toBe(done);

    fireEvent.click(done);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByDisplayValue("Tmp-once-XYZ")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("ignores Escape and backdrop clicks while the reset is in flight", async () => {
    let finish: (v: unknown) => void = () => {};
    apiFetch.mockReturnValue(new Promise((r) => (finish = r)));
    const { dialog } = openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset password" }));
    await within(dialog).findByRole("button", { name: "Resetting…" });

    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(dialog.parentElement!);
    expect(screen.getByRole("dialog")).toBe(dialog);

    finish({ user_id: 1, mode: "generate", must_change_password: true, temporary_password: null });
    await within(dialog).findByRole("button", { name: "Done" });
  });

  /** Leave focus on <body>, as a browser does when the focused button gets
   * disabled. (jsdom keeps it on the disabled button and won't blur it, but
   * does drop focus when the focused element is removed.) */
  function dropFocus() {
    const placeholder = document.createElement("button");
    document.body.appendChild(placeholder);
    placeholder.focus();
    placeholder.remove();
    expect(document.activeElement).toBe(document.body);
  }

  for (const mode of ["generate", "set"] as const) {
    it(`puts focus back in the dialog after a failed reset (${mode})`, async () => {
      let fail: (e: unknown) => void = () => {};
      apiFetch.mockReturnValue(new Promise((_, reject) => (fail = reject)));
      const { trigger, dialog } = openDialog();
      if (mode === "set") {
        fireEvent.click(within(dialog).getByLabelText("Set a password"));
        fireEvent.change(within(dialog).getByPlaceholderText("New password"), {
          target: { value: "a-long-enough-password" },
        });
      }
      const submit = within(dialog).getByRole("button", { name: "Reset password" });
      submit.focus();
      fireEvent.click(submit);
      await within(dialog).findByRole("button", { name: "Resetting…" });
      dropFocus(); // what a browser does to the button it just disabled

      fail(new Error("Server said no"));

      expect(await within(dialog).findByRole("alert")).toHaveProperty("textContent", "Server said no");
      const expected =
        mode === "set"
          ? within(dialog).getByPlaceholderText("New password")
          : within(dialog).getByLabelText("Generate a temporary password");
      await waitFor(() => expect(document.activeElement).toBe(expected));

      // Escape works again, from where focus now is.
      fireEvent.keyDown(document.activeElement!, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
  }

  it("leaves focus where it is after a failed reset if it is still in the dialog", async () => {
    let fail: (e: unknown) => void = () => {};
    apiFetch.mockReturnValue(new Promise((_, reject) => (fail = reject)));
    const { dialog } = openDialog();
    const submit = within(dialog).getByRole("button", { name: "Reset password" });
    submit.focus();
    fireEvent.click(submit);
    await within(dialog).findByRole("button", { name: "Resetting…" });
    expect(document.activeElement).toBe(submit); // never left the dialog

    fail(new Error("Server said no"));

    await within(dialog).findByRole("alert");
    await within(dialog).findByRole("button", { name: "Reset password" });
    expect(document.activeElement).toBe(submit);
  });

  it("leaves focus alone on a validation error (no request, nothing disabled)", () => {
    const { dialog } = openDialog();
    fireEvent.click(within(dialog).getByLabelText("Set a password"));
    const submit = within(dialog).getByRole("button", { name: "Reset password" });
    submit.focus();
    fireEvent.click(submit); // too short: rejected before any request
    expect(within(dialog).getByRole("alert").textContent).toMatch(/at least/);
    expect(document.activeElement).toBe(submit);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("opens and closes cleanly under StrictMode: focus in, focus back, no inert left", () => {
    const { container } = render(
      <StrictMode>
        <Page />
      </StrictMode>,
    );
    const trigger = screen.getByRole("button", { name: "Reset password" });
    for (const close of [
      (d: HTMLElement) => fireEvent.keyDown(d, { key: "Escape" }),
      (d: HTMLElement) => fireEvent.click(within(d).getByRole("button", { name: "Cancel" })),
    ]) {
      trigger.focus();
      fireEvent.click(trigger);
      const dialog = screen.getByRole("dialog");
      expect(document.activeElement).toBe(within(dialog).getByLabelText("Generate a temporary password"));
      expect(container.hasAttribute("inert")).toBe(true);
      expect(dialog.parentElement!.hasAttribute("inert")).toBe(false);

      close(dialog);

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(trigger);
      expect(document.querySelectorAll("[inert]")).toHaveLength(0);
    }
  });

  it("does not close when a press starts in the dialog and ends on the backdrop", () => {
    const { dialog } = openDialog();
    const backdrop = dialog.parentElement!;
    // E.g. selecting the temporary password by dragging past the panel edge.
    fireEvent.mouseDown(within(dialog).getByText(/signs alice out/));
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);
    expect(screen.getByRole("dialog")).toBe(dialog);

    // A press that starts and ends on the backdrop closes it.
    fireEvent.mouseDown(backdrop);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not close when a press starts on the backdrop and ends in the dialog", () => {
    const { dialog } = openDialog();
    const backdrop = dialog.parentElement!;
    fireEvent.mouseDown(backdrop);
    fireEvent.mouseUp(within(dialog).getByText(/signs alice out/));
    // The browser fires the click on the common ancestor: the backdrop.
    fireEvent.click(backdrop);
    expect(screen.getByRole("dialog")).toBe(dialog);

    // The next press is judged on its own.
    fireEvent.mouseDown(backdrop);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("returns focus to the pressed trigger when the click didn't focus it (Safari)", () => {
    render(<Page />);
    const trigger = screen.getByRole("button", { name: "Reset password" });
    const inner = document.createElement("span");
    trigger.appendChild(inner);
    // Safari / macOS Firefox: pointerdown + click, but the button never takes
    // focus, so activeElement is <body> when the dialog opens.
    fireEvent.pointerDown(inner);
    fireEvent.click(trigger);
    expect(document.activeElement).not.toBe(trigger);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(document.activeElement).toBe(trigger);
  });

  it("falls back to the page heading when there is nothing to return focus to", () => {
    render(<Page />);
    // Opened with nothing focused and no recorded press (e.g. by script).
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    const heading = screen.getByRole("heading", { name: "Users" });
    expect(document.activeElement).toBe(heading);
  });

  it("gives each instance its own dialog and field ids", async () => {
    render(<Page count={2} />);
    const [first, second] = screen.getAllByRole("button", { name: "Reset password" });
    fireEvent.click(first);
    // The page is inert now, but a test can still dispatch the click.
    fireEvent.click(second);

    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs).toHaveLength(2);
    // Title, description and the mode radios' group are all per instance.
    const ids = dialogs.flatMap((d) => Array.from(d.querySelectorAll("[id]"), (el) => el.id));
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of dialogs) {
      expect(d.contains(document.getElementById(d.getAttribute("aria-labelledby")!))).toBe(true);
      expect(d.contains(document.getElementById(d.getAttribute("aria-describedby")!))).toBe(true);
    }
    const radioGroups = dialogs.map(
      (d) => within(d).getByLabelText<HTMLInputElement>("Set a password").name,
    );
    expect(radioGroups[0]).not.toBe(radioGroups[1]);

    // Only the top one is interactive; closing it hands that back.
    expect(dialogs[0].parentElement!.hasAttribute("inert")).toBe(true);
    fireEvent.keyDown(dialogs[1], { key: "Escape" });
    await waitFor(() => expect(dialogs[0].parentElement!.hasAttribute("inert")).toBe(false));
  });
});
