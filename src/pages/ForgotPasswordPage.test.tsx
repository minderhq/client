import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RESET_REQUEST_SENT } from "../components/PasswordResetRequestForm";
import { ASK_ADMIN_TO_RESET, ForgotPasswordPage } from "./ForgotPasswordPage";

function respond(status: number, body?: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const CAPS_ON = { password_reset_email: true, email_verification: false, registration_mode: "open" };

/** Routes the capabilities GET and the reset request POST to separate mocks. */
function mockGateway(caps: unknown, request: () => Response) {
  vi.mocked(fetch).mockImplementation(async (url) =>
    String(url).endsWith("/v1/auth/capabilities") ? respond(200, caps) : request(),
  );
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ForgotPasswordPage />
    </MemoryRouter>,
  );
}

async function submit(email: string) {
  fireEvent.change(await screen.findByLabelText("Email"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
}

describe("ForgotPasswordPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the same neutral confirmation for every accepted request", async () => {
    mockGateway(CAPS_ON, () =>
      respond(202, { detail: "If an account exists for that address, we've sent instructions." }),
    );
    renderPage();
    await submit("someone@example.com");
    const shown = (await screen.findByRole("status")).textContent;
    expect(shown).toBe(RESET_REQUEST_SENT);
    expect(shown).not.toContain("someone@example.com");
    expect(shown).toMatch(/spam folder/);
    expect(shown).toMatch(/expires within an hour/);
    expect(screen.queryByLabelText("Email")).toBeNull();
    // Focus moves to the confirmation so it is read out.
    expect(document.activeElement?.textContent).toBe(shown);
    cleanup();

    // A different (e.g. unknown) address reads exactly the same.
    sessionStorage.clear();
    renderPage();
    await submit("nobody@example.com");
    expect((await screen.findByRole("status")).textContent).toBe(shown);
  });

  it("asks the user to wait when rate limited (429)", async () => {
    mockGateway(CAPS_ON, () => respond(429, { detail: "Too many requests" }));
    renderPage();
    await submit("someone@example.com");
    expect((await screen.findByRole("alert")).textContent).toMatch(/Wait a minute/);
    expect(screen.getByRole("button", { name: "Send reset link" }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("tells the user to ask an administrator when the server has no email reset", async () => {
    mockGateway({ ...CAPS_ON, password_reset_email: false }, () => respond(404));
    renderPage();
    await screen.findByText(ASK_ADMIN_TO_RESET);
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1); // the capabilities check only
  });

  it("treats a gateway without the capabilities endpoint as no email reset", async () => {
    vi.mocked(fetch).mockResolvedValue(respond(404, { detail: "Not Found" }));
    renderPage();
    await screen.findByText(/isn't available on this server/);
  });
});
