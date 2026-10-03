import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RESET_REQUEST_CONFIRMATION } from "../lib/passwordReset";
import { PasswordResetRequestForm } from "./PasswordResetRequestForm";

function respond(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers({ "content-type": "application/json" }),
  } as Response;
}

function submit(email: string) {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
}

/** What a user sees after submitting `email` with the gateway answering
 * `response`: the rendered status region's text. */
async function confirmationFor(email: string, response: Response): Promise<string> {
  vi.mocked(fetch).mockResolvedValueOnce(response);
  const { unmount } = render(<PasswordResetRequestForm />);
  submit(email);
  const status = await screen.findByRole("status");
  const text = status.textContent ?? "";
  unmount();
  return text;
}

describe("PasswordResetRequestForm", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the same confirmation for a known and an unknown address", async () => {
    // The gateway answers both with the same 202. The client must not let
    // anything else (the address typed, the server's wording) vary the copy.
    const known = await confirmationFor(
      "alice@example.com",
      respond(202, { detail: "If an account exists for that address, we've sent instructions." }),
    );
    const unknown = await confirmationFor(
      "nobody@example.com",
      respond(202, { detail: "some other server wording" }),
    );
    expect(known).toBe(unknown);
    expect(known).toContain(RESET_REQUEST_CONFIRMATION);
    expect(known).not.toContain("alice");
  });

  it("moves focus to the confirmation and removes the form", async () => {
    vi.mocked(fetch).mockResolvedValue(respond(202, {}));
    render(<PasswordResetRequestForm />);
    submit("a@example.com");
    const status = await screen.findByRole("status");
    expect(document.activeElement).toBe(status);
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(screen.queryByLabelText("Email")).toBeNull();
  });

  it("disables the form while the request is in flight", async () => {
    let resolve!: (r: Response) => void;
    vi.mocked(fetch).mockReturnValue(new Promise((r) => (resolve = r)));
    render(<PasswordResetRequestForm />);
    submit("a@example.com");
    expect(screen.getByRole("button", { name: "Sending…" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByLabelText("Email").hasAttribute("disabled")).toBe(true);
    resolve(respond(202, {}));
    await screen.findByRole("status");
  });

  it.each([
    [429, /Too many requests from this network\. Wait a minute/],
    [422, /Enter a valid email address/],
    [404, /isn't available on this server/],
  ])("explains a %i without a confirmation", async (status, message) => {
    vi.mocked(fetch).mockResolvedValue(respond(status, { detail: "x" }));
    render(<PasswordResetRequestForm />);
    submit("a@example.com");
    await screen.findByText(message);
    expect(screen.getByRole("alert").textContent).toMatch(message);
    expect(screen.queryByText(RESET_REQUEST_CONFIRMATION)).toBeNull();
    // The form stays usable, focused on the field to retry.
    const field = screen.getByLabelText("Email");
    expect(document.activeElement).toBe(field);
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("button", { name: "Send reset link" }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("reports a network failure and keeps the form", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    render(<PasswordResetRequestForm />);
    submit("a@example.com");
    await screen.findByText(/Couldn't reach the server/);
    expect(screen.getByRole("alert").textContent).toMatch(/Couldn't reach the server/);
    expect(screen.getByLabelText("Email")).toBeTruthy();
  });

  it("can carry a different submit label", () => {
    render(<PasswordResetRequestForm submitLabel="Send me a new link" />);
    expect(screen.getByRole("button", { name: "Send me a new link" })).toBeTruthy();
  });
});
