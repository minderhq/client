import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

describe("ForcePasswordChangeGate (#1776)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mustChangePassword = true;
  });

  it("renders the app normally when no change is required", () => {
    mustChangePassword = false;
    render(
      <ForcePasswordChangeGate>
        <div>app routes</div>
      </ForcePasswordChangeGate>,
    );
    expect(screen.getByText("app routes")).toBeTruthy();
  });

  it("replaces the app with the change-password form and clears the flag on success", async () => {
    changePassword.mockResolvedValue(undefined);
    render(
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
    render(
      <ForcePasswordChangeGate>
        <div>app routes</div>
      </ForcePasswordChangeGate>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(logout).toHaveBeenCalled();
  });
});
