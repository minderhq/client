import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UserProfile } from "../lib/profile";
import { SettingsPage } from "./SettingsPage";

const logout = vi.fn();
let isAuthenticated = true;
let autheliaPortalUrl: string | null = "https://auth.minder.local/";

const fetchMyProfile = vi.fn();
const updateMyProfile = vi.fn();
const setTheme = vi.fn();
const changePassword = vi.fn();

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    isAuthenticated,
    username: "alice",
    email: "alice@example.com",
    role: "admin",
    token: "tok",
    logout,
  }),
}));
vi.mock("react-router-dom", () => ({
  Navigate: ({ to, replace }: { to: string; replace?: boolean }) => (
    <div data-testid="navigate" data-to={to} data-replace={String(replace)} />
  ),
}));
vi.mock("../lib/api", () => ({
  get autheliaPortalUrl() {
    return autheliaPortalUrl;
  },
  // useAsyncResource -> friendlyErrorMessage lives in lib/api; keep it real-ish.
  friendlyErrorMessage: (e: unknown) =>
    e instanceof Error ? e.message : String(e),
}));
vi.mock("../lib/profile", () => ({
  fetchMyProfile: (...args: unknown[]) => fetchMyProfile(...args),
  updateMyProfile: (...args: unknown[]) => updateMyProfile(...args),
}));
vi.mock("../lib/password", () => ({
  MIN_PASSWORD_LENGTH: 8,
  changePassword: (...args: unknown[]) => changePassword(...args),
}));
vi.mock("../lib/theme", () => ({
  getTheme: () => "system",
  setTheme: (...args: unknown[]) => setTheme(...args),
}));

function profileFixture(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    user_id: 1,
    display_name: null,
    preferences: {},
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

describe("SettingsPage", () => {
  beforeEach(() => {
    logout.mockClear();
    fetchMyProfile.mockReset();
    updateMyProfile.mockReset();
    setTheme.mockReset();
    changePassword.mockReset();
    changePassword.mockResolvedValue(undefined);
    isAuthenticated = true;
    autheliaPortalUrl = "https://auth.minder.local/";
    fetchMyProfile.mockResolvedValue(profileFixture());
    updateMyProfile.mockResolvedValue(profileFixture());
  });
  afterEach(() => cleanup());

  it("redirects home when not authenticated", () => {
    isAuthenticated = false;
    render(<SettingsPage />);
    const nav = screen.getByTestId("navigate");
    expect(nav.dataset.to).toBe("/");
    expect(nav.dataset.replace).toBe("true");
  });

  it("displays the current JWT claims", () => {
    render(<SettingsPage />);
    expect(screen.getByText("alice")).toBeTruthy();
    expect(screen.getByText("alice@example.com")).toBeTruthy();
    expect(screen.getByText("admin")).toBeTruthy();
  });

  it("calls logout() when Log out is clicked", () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("links to Authelia's portal when configured", () => {
    render(<SettingsPage />);
    const link = screen.getByRole("link", { name: "Authelia's own portal" });
    expect(link.getAttribute("href")).toBe("https://auth.minder.local/");
  });

  it("falls back to plain text when no Authelia portal is configured", () => {
    autheliaPortalUrl = null;
    render(<SettingsPage />);
    expect(
      screen.queryByRole("link", { name: "Authelia's own portal" }),
    ).toBeNull();
    expect(
      screen.getByText(/your identity provider's portal \(Authelia\)/),
    ).toBeTruthy();
  });

  it("hydrates the Minder profile form from the loaded profile", async () => {
    fetchMyProfile.mockResolvedValue(
      profileFixture({ display_name: "Ali", preferences: { theme: "dark" } }),
    );
    render(<SettingsPage />);
    const input = (await screen.findByLabelText(
      "Display name",
    )) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("Ali"));
    const select = screen.getByLabelText("Theme") as HTMLSelectElement;
    expect(select.value).toBe("dark");
    expect(fetchMyProfile).toHaveBeenCalledWith("tok", expect.anything());
  });

  it("saves display name + theme and applies the theme locally", async () => {
    render(<SettingsPage />);
    const input = (await screen.findByLabelText(
      "Display name",
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  Ali  " } });
    fireEvent.change(screen.getByLabelText("Theme"), {
      target: { value: "light" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => expect(updateMyProfile).toHaveBeenCalledTimes(1));
    const [body, token] = updateMyProfile.mock.calls[0];
    expect(token).toBe("tok");
    // display name is trimmed; theme carried into the preferences blob.
    expect(body.display_name).toBe("Ali");
    expect(body.preferences.theme).toBe("light");
    expect(setTheme).toHaveBeenCalledWith("light");
    expect(await screen.findByText("Profile saved.")).toBeTruthy();
  });

  it("sends null display name when the field is cleared", async () => {
    render(<SettingsPage />);
    await screen.findByLabelText("Display name");
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(updateMyProfile).toHaveBeenCalledTimes(1));
    expect(updateMyProfile.mock.calls[0][0].display_name).toBeNull();
  });

  it("surfaces a save error", async () => {
    updateMyProfile.mockRejectedValue(new Error("nope"));
    render(<SettingsPage />);
    await screen.findByLabelText("Display name");
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    expect(await screen.findByText("nope")).toBeTruthy();
  });

  describe("change password (minderhq/minder#1776)", () => {
    function fill(current: string, next: string, confirm: string) {
      fireEvent.change(screen.getByLabelText("Current password"), {
        target: { value: current },
      });
      fireEvent.change(screen.getByLabelText("New password"), {
        target: { value: next },
      });
      fireEvent.change(screen.getByLabelText("Confirm new password"), {
        target: { value: confirm },
      });
      fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    }

    it("changes the password and clears the form", async () => {
      render(<SettingsPage />);
      fill("old-password", "new-password-1", "new-password-1");
      expect(await screen.findByText("Password changed.")).toBeTruthy();
      expect(changePassword).toHaveBeenCalledWith(
        "old-password",
        "new-password-1",
        "tok",
      );
      expect(
        (screen.getByLabelText("Current password") as HTMLInputElement).value,
      ).toBe("");
    });

    it("rejects mismatched confirmation without calling the API", async () => {
      render(<SettingsPage />);
      fill("old-password", "new-password-1", "new-password-2");
      expect(await screen.findByText("New passwords don't match.")).toBeTruthy();
      expect(changePassword).not.toHaveBeenCalled();
    });

    it("rejects a too-short new password without calling the API", async () => {
      render(<SettingsPage />);
      fill("old-password", "short", "short");
      expect(
        await screen.findByText("New password must be at least 8 characters."),
      ).toBeTruthy();
      expect(changePassword).not.toHaveBeenCalled();
    });

    it("rejects reusing the current password without calling the API", async () => {
      render(<SettingsPage />);
      fill("same-password", "same-password", "same-password");
      expect(
        await screen.findByText(
          "New password must differ from the current password.",
        ),
      ).toBeTruthy();
      expect(changePassword).not.toHaveBeenCalled();
    });

    it("surfaces the server's message (wrong current / SSO-managed)", async () => {
      changePassword.mockRejectedValue(
        new Error("Current password is incorrect"),
      );
      render(<SettingsPage />);
      fill("wrong-password", "new-password-1", "new-password-1");
      expect(
        await screen.findByText("Current password is incorrect"),
      ).toBeTruthy();
    });
  });
});
