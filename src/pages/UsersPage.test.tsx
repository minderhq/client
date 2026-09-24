import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UsersPage, type ManagedUser } from "./UsersPage";

const apiFetch = vi.fn();

vi.mock("../lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  friendlyErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
}));

let mockAuth: { token: string; role: string; userId?: string } = {
  token: "",
  role: "",
};
vi.mock("../lib/auth", () => ({
  useAuth: () => mockAuth,
}));

function user(overrides: Partial<ManagedUser> = {}): ManagedUser {
  return {
    id: 1,
    username: "alice",
    email: "alice@example.com",
    role: "user",
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    is_oidc_linked: false,
    ...overrides,
  };
}

describe("UsersPage", () => {
  afterEach(() => {
    cleanup();
    apiFetch.mockReset();
    mockAuth = { token: "", role: "" };
  });

  it("shows an admin-required hint and never fetches when logged out", () => {
    render(<UsersPage />);
    expect(
      screen.getByText("Log in as an admin to view or manage users."),
    ).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("shows an admin-required hint (different copy) when logged in as a non-admin", () => {
    mockAuth = { token: "tok", role: "user" };
    render(<UsersPage />);
    expect(
      screen.getByText("Admin role required to view or manage users."),
    ).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("fetches and renders users for an admin", async () => {
    mockAuth = { token: "tok", role: "admin" };
    apiFetch.mockResolvedValue({
      users: [user()],
      total: 1,
      limit: 50,
      offset: 0,
    });
    render(<UsersPage />);

    await screen.findByText("alice");
    expect(screen.getByText("alice@example.com")).toBeTruthy();
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/auth/users",
      expect.objectContaining({ token: "tok", signal: expect.any(AbortSignal) }),
    );
  });

  it("shows an empty state when there are no users", async () => {
    mockAuth = { token: "tok", role: "admin" };
    apiFetch.mockResolvedValue({ users: [], total: 0, limit: 50, offset: 0 });
    render(<UsersPage />);

    await screen.findByText("No users found.");
  });

  it("shows an SSO-managed badge instead of a role dropdown for OIDC-linked accounts", async () => {
    mockAuth = { token: "tok", role: "admin" };
    apiFetch.mockResolvedValue({
      users: [user({ is_oidc_linked: true, role: "admin" })],
      total: 1,
      limit: 50,
      offset: 0,
    });
    render(<UsersPage />);

    await screen.findByText("admin (SSO-managed)");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("changes a local account's role via PATCH and reloads", async () => {
    mockAuth = { token: "tok", role: "admin" };
    apiFetch.mockImplementation(
      (_path: string, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return Promise.resolve(user({ role: "admin" }));
        return Promise.resolve({
          users: [user()],
          total: 1,
          limit: 50,
          offset: 0,
        });
      },
    );
    render(<UsersPage />);
    await screen.findByText("alice");

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "admin" } });

    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/auth/users/1/role", {
        method: "PATCH",
        token: "tok",
        body: { role: "admin" },
      }),
    );
  });

  it("shows a friendly error when a role change fails (e.g. the 409 for an SSO account)", async () => {
    mockAuth = { token: "tok", role: "admin" };
    apiFetch.mockImplementation(
      (_path: string, opts?: { method?: string }) => {
        if (opts?.method === "PATCH")
          return Promise.reject(new Error("managed by Authelia"));
        return Promise.resolve({
          users: [user()],
          total: 1,
          limit: 50,
          offset: 0,
        });
      },
    );
    render(<UsersPage />);
    await screen.findByText("alice");

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "admin" } });

    await screen.findByText("managed by Authelia");
  });

  describe("deactivate / reactivate (minderhq/minder#1803)", () => {
    function listing(users: ManagedUser[]) {
      apiFetch.mockImplementation(
        (_path: string, opts?: { method?: string }) => {
          if (opts?.method === "PATCH") return Promise.resolve(users[0]);
          return Promise.resolve({
            users,
            total: users.length,
            limit: 50,
            offset: 0,
          });
        },
      );
    }

    function patchCalls() {
      return apiFetch.mock.calls.filter(
        (c) => (c[1] as { method?: string } | undefined)?.method === "PATCH",
      );
    }

    it("deactivates after confirming", async () => {
      mockAuth = { token: "tok", role: "admin", userId: "99" };
      listing([user()]);
      render(<UsersPage />);
      await screen.findByText("alice");

      fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
      const dialog = await screen.findByRole("alertdialog");
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Deactivate" }),
      );

      await vi.waitFor(() =>
        expect(apiFetch).toHaveBeenCalledWith("/v1/auth/users/1/status", {
          method: "PATCH",
          token: "tok",
          body: { is_active: false },
        }),
      );
    });

    it("cancelling the confirm dialog does not deactivate", async () => {
      mockAuth = { token: "tok", role: "admin", userId: "99" };
      listing([user()]);
      render(<UsersPage />);
      await screen.findByText("alice");

      fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
      const dialog = await screen.findByRole("alertdialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

      expect(patchCalls()).toHaveLength(0);
    });

    it("reactivates a disabled account without a confirm", async () => {
      mockAuth = { token: "tok", role: "admin", userId: "99" };
      listing([user({ is_active: false })]);
      render(<UsersPage />);
      await screen.findByText("alice");
      expect(screen.getByText("disabled")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Reactivate" }));

      await vi.waitFor(() =>
        expect(apiFetch).toHaveBeenCalledWith("/v1/auth/users/1/status", {
          method: "PATCH",
          token: "tok",
          body: { is_active: true },
        }),
      );
    });

    it("hides the control on the admin's own row", async () => {
      mockAuth = { token: "tok", role: "admin", userId: "1" };
      listing([user()]);
      render(<UsersPage />);
      await screen.findByText("alice");
      expect(screen.queryByRole("button", { name: "Deactivate" })).toBeNull();
    });

    it("surfaces the last-admin 409 as a status message", async () => {
      mockAuth = { token: "tok", role: "admin", userId: "99" };
      apiFetch.mockImplementation(
        (_path: string, opts?: { method?: string }) => {
          if (opts?.method === "PATCH")
            return Promise.reject(
              new Error("Cannot deactivate the last remaining admin"),
            );
          return Promise.resolve({
            users: [user({ role: "admin" })],
            total: 1,
            limit: 50,
            offset: 0,
          });
        },
      );
      render(<UsersPage />);
      await screen.findByText("alice");

      fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
      const dialog = await screen.findByRole("alertdialog");
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Deactivate" }),
      );

      expect(
        await screen.findByText("Cannot deactivate the last remaining admin"),
      ).toBeTruthy();
    });
  });

  describe("reset password (#1776)", () => {
    function resetListing(
      users: ManagedUser[],
      reset: () => Promise<unknown> = () =>
        Promise.resolve({
          user_id: users[0].id,
          mode: "generate",
          must_change_password: true,
          temporary_password: "Tmp-once-XYZ",
        }),
    ) {
      apiFetch.mockImplementation(
        (path: string, opts?: { method?: string }) => {
          if (opts?.method === "POST" && path.endsWith("/reset-password"))
            return reset();
          return Promise.resolve({
            users,
            total: users.length,
            limit: 50,
            offset: 0,
          });
        },
      );
    }

    function resetCalls() {
      return apiFetch.mock.calls.filter(([path]) =>
        String(path).endsWith("/reset-password"),
      );
    }

    it("generates a temporary password and shows it once with a copy button", async () => {
      mockAuth = { token: "tok", role: "admin", userId: "99" };
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      resetListing([user()]);
      render(<UsersPage />);
      await screen.findByText("alice");

      fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Reset password" }),
      );

      const field = (await within(dialog).findByLabelText(
        "Temporary password",
      )) as HTMLInputElement;
      expect(field.value).toBe("Tmp-once-XYZ");
      expect(within(dialog).getByText(/Shown once/)).toBeTruthy();
      expect(resetCalls()).toHaveLength(1);
      expect(resetCalls()[0]).toEqual([
        "/v1/auth/users/1/reset-password",
        { method: "POST", token: "tok", body: { mode: "generate" } },
      ]);

      fireEvent.click(within(dialog).getByRole("button", { name: /Copy/ }));
      expect(writeText).toHaveBeenCalledWith("Tmp-once-XYZ");
      expect(await within(dialog).findByText("Copied")).toBeTruthy();

      fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.queryByDisplayValue("Tmp-once-XYZ")).toBeNull();
    });

    it("sets an admin-chosen password, enforcing the length policy", async () => {
      mockAuth = { token: "tok", role: "admin", userId: "99" };
      resetListing([user()], () =>
        Promise.resolve({
          user_id: 1,
          mode: "set",
          must_change_password: true,
          temporary_password: null,
        }),
      );
      render(<UsersPage />);
      await screen.findByText("alice");

      fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.click(within(dialog).getByLabelText("Set a password"));
      const input = within(dialog).getByLabelText("New password for alice");
      const submit = within(dialog).getByRole("button", {
        name: "Reset password",
      });

      fireEvent.change(input, { target: { value: "short" } });
      fireEvent.click(submit);
      expect(
        await within(dialog).findByText(/at least 8 characters/),
      ).toBeTruthy();
      expect(resetCalls()).toHaveLength(0);

      fireEvent.change(input, { target: { value: "admin-chosen-1" } });
      fireEvent.click(submit);
      expect(await within(dialog).findByText(/was reset/)).toBeTruthy();
      expect(resetCalls()[0][1]).toEqual({
        method: "POST",
        token: "tok",
        body: { mode: "set", new_password: "admin-chosen-1" },
      });
      expect(within(dialog).queryByLabelText("Temporary password")).toBeNull();
    });

    it("cancel closes the dialog without resetting", async () => {
      mockAuth = { token: "tok", role: "admin", userId: "99" };
      resetListing([user()]);
      render(<UsersPage />);
      await screen.findByText("alice");

      fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(resetCalls()).toHaveLength(0);
    });

    it("surfaces a server refusal in the dialog", async () => {
      mockAuth = { token: "tok", role: "admin", userId: "99" };
      resetListing([user()], () =>
        Promise.reject(new Error("reset its password in the Authelia portal")),
      );
      render(<UsersPage />);
      await screen.findByText("alice");

      fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Reset password" }),
      );
      expect(
        await within(dialog).findByText(/Authelia portal/),
      ).toBeTruthy();
    });

    it("hides the action on the admin's own row and on SSO accounts", async () => {
      mockAuth = { token: "tok", role: "admin", userId: "1" };
      resetListing([user(), user({ id: 2, username: "bob", is_oidc_linked: true })]);
      render(<UsersPage />);
      await screen.findByText("bob");
      expect(screen.queryByRole("button", { name: "Reset password" })).toBeNull();
    });
  });
});
