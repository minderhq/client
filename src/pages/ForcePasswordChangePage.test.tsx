import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isGateExemptPath } from "../lib/recoveryRoutes";
import { ForcePasswordChangeGate } from "./ForcePasswordChangePage";

const changePassword = vi.fn();
const clearMustChangePassword = vi.fn();
const logout = vi.fn();
let mustChangePassword = true;

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    token: "tok",
    mustChangePassword,
    clearMustChangePassword,
    logout,
  }),
}));
vi.mock("../lib/password", () => ({
  MIN_PASSWORD_LENGTH: 8,
  changePassword: (...args: unknown[]) => changePassword(...args),
}));

function renderAt(path: string, ui: ReactElement) {
  return render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
}

describe("ForcePasswordChangeGate (#1776)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mustChangePassword = true;
  });

  it("renders the app normally when no change is required", () => {
    mustChangePassword = false;
    renderAt(
      "/",
      <ForcePasswordChangeGate>
        <div>app routes</div>
      </ForcePasswordChangeGate>,
    );
    expect(screen.getByText("app routes")).toBeTruthy();
  });

  it("replaces the app with the change-password form and clears the flag on success", async () => {
    changePassword.mockResolvedValue(undefined);
    renderAt(
      "/",
      <ForcePasswordChangeGate>
        <div>app routes</div>
      </ForcePasswordChangeGate>,
    );
    expect(screen.queryByText("app routes")).toBeNull();
    expect(screen.getByText(/An administrator reset your password/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "temp-pass-1" },
    });
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "my-own-pass-1" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "my-own-pass-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() => expect(clearMustChangePassword).toHaveBeenCalled());
    expect(changePassword).toHaveBeenCalledWith(
      "temp-pass-1",
      "my-own-pass-1",
      "tok",
    );
  });

  it("offers sign-out instead of changing", () => {
    renderAt(
      "/",
      <ForcePasswordChangeGate>
        <div>app routes</div>
      </ForcePasswordChangeGate>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(logout).toHaveBeenCalled();
  });

  it.each(["/reset-password", "/Reset-Password/", "/forgot-password"])(
    "lets the public recovery route %s through while a change is required (#2138)",
    (path) => {
      renderAt(
        path,
        <ForcePasswordChangeGate>
          <div>app routes</div>
        </ForcePasswordChangeGate>,
      );
      expect(screen.getByText("app routes")).toBeTruthy();
      expect(screen.queryByText(/An administrator reset your password/)).toBeNull();
    },
  );

  it("matches exempt routes as React Router does, and nothing else", () => {
    expect(isGateExemptPath("/reset-password")).toBe(true);
    expect(isGateExemptPath("/RESET-PASSWORD//")).toBe(true);
    expect(isGateExemptPath("/forgot-password/")).toBe(true);
    expect(isGateExemptPath("/reset-password/extra")).toBe(false);
    expect(isGateExemptPath("/reset-password-x")).toBe(false);
    expect(isGateExemptPath("/settings")).toBe(false);
    expect(isGateExemptPath("/")).toBe(false);
  });
});
