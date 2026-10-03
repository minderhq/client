import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthCapabilities } from "../lib/passwordReset";
import { ForgotPasswordPage } from "./ForgotPasswordPage";

let capabilities: AuthCapabilities | null = null;

vi.mock("../lib/passwordReset", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/passwordReset")>("../lib/passwordReset");
  return {
    ...actual,
    useAuthCapabilities: () => ({
      capabilities,
      passwordResetEmail: capabilities?.password_reset_email === true,
      loading: false,
    }),
  };
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ForgotPasswordPage />
    </MemoryRouter>,
  );
}

const caps = (on: boolean): AuthCapabilities => ({
  password_reset_email: on,
  email_verification: false,
  registration_mode: "open",
});

describe("ForgotPasswordPage", () => {
  afterEach(() => {
    cleanup();
    capabilities = null;
  });

  it("shows the request form when email reset is available", () => {
    capabilities = caps(true);
    renderPage();
    expect(screen.getByRole("heading", { name: "Reset your password" })).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send reset link" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to sign in" }).getAttribute("href")).toBe(
      "/login",
    );
  });

  it("explains, instead of offering a form, when email reset is off", () => {
    capabilities = caps(false);
    renderPage();
    expect(screen.getByText(/isn't available on this server/)).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toBeTruthy();
  });

  it("still offers the form when the capabilities couldn't be read", () => {
    capabilities = null;
    renderPage();
    expect(screen.getByLabelText("Email")).toBeTruthy();
  });
});
