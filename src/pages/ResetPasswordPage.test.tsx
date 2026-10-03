import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RESET_REQUEST_CONFIRMATION } from "../lib/passwordReset";
import { ResetPasswordPage } from "./ResetPasswordPage";

const navigate = vi.fn();
const logout = vi.fn();
let isAuthenticated = false;

vi.mock("../lib/auth", () => ({
  useAuth: () => ({ isAuthenticated, logout }),
}));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

const TOKEN = "mpr_Zm9vYmFyYmF6cXV4cXV1eHF1dXhxdXV4cXV1eHF1dXg";

function respond(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers({ "content-type": "application/json" }),
  } as Response;
}

/** Open the page the way an email link does: the token in the fragment. */
function openLink(hash = `#token=${TOKEN}`) {
  window.history.replaceState({ idx: 0 }, "", `/reset-password${hash}`);
  return render(
    <MemoryRouter>
      <ResetPasswordPage />
    </MemoryRouter>,
  );
}

function fillAndSubmit(password: string, confirmation = password) {
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirm new password"), {
    target: { value: confirmation },
  });
  fireEvent.click(screen.getByRole("button", { name: "Set new password" }));
}

function fetchCalls(path: string) {
  return vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith(path));
}

describe("ResetPasswordPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    navigate.mockClear();
    logout.mockClear();
    isAuthenticated = false;
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  describe("on load", () => {
    it("removes the token from the address bar and history entry", () => {
      openLink();
      expect(window.location.hash).toBe("");
      expect(window.location.href).not.toContain(TOKEN);
      expect(window.location.pathname).toBe("/reset-password");
      // Router state of the entry survives the replaceState.
      expect(window.history.state).toEqual({ idx: 0 });
      expect(screen.getByRole("heading", { name: "Choose a new password" })).toBeTruthy();
    });

    it("sends nothing until the user submits", () => {
      openLink();
      expect(fetch).not.toHaveBeenCalled();
    });

    it("adds a no-referrer meta while open", () => {
      const { unmount } = openLink();
      expect(
        document.head.querySelector<HTMLMetaElement>('meta[name="referrer"]')?.content,
      ).toBe("no-referrer");
      unmount();
      expect(document.head.querySelector('meta[name="referrer"]')).toBeNull();
    });

    it("labels both password fields and states the policy", () => {
      openLink();
      const field = screen.getByLabelText("New password");
      expect(field.getAttribute("autocomplete")).toBe("new-password");
      expect(screen.getByLabelText("Confirm new password").getAttribute("autocomplete")).toBe(
        "new-password",
      );
      expect(field.getAttribute("aria-describedby")).toContain("reset-new-password-hint");
      expect(screen.getByText("At least 8 characters.")).toBeTruthy();
    });

    it.each([
      ["no fragment", ""],
      ["an empty token", "#token="],
      ["another parameter only", "#foo=bar"],
    ])("offers a new link when the URL has %s", (_name, hash) => {
      openLink(hash);
      expect(screen.getByText("This page needs the link from your reset email.")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Send me a new link" })).toBeTruthy();
      expect(screen.queryByLabelText("New password")).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe("password policy", () => {
    it.each([
      ["too short", "short", "short", /at least 8 characters/, "New password"],
      ["over 72 bytes", "a".repeat(73), "a".repeat(73), /at most 72 bytes/, "New password"],
      ["mismatched", "longenough1", "longenough2", /don't match/, "Confirm new password"],
    ])("refuses a %s password without sending it", (_name, pw, confirmation, message, field) => {
      openLink();
      fillAndSubmit(pw, confirmation);
      expect(screen.getByRole("alert").textContent).toMatch(message);
      expect(fetch).not.toHaveBeenCalled();
      const input = screen.getByLabelText(field);
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(input.getAttribute("aria-describedby")).toContain("reset-password-error");
      expect(document.activeElement).toBe(input);
    });
  });

  describe("submit", () => {
    it("POSTs the token and password, then routes to sign in with a confirmation", async () => {
      vi.mocked(fetch).mockResolvedValue(respond(204));
      openLink();
      fillAndSubmit("a brand new password");
      await vi.waitFor(() =>
        expect(navigate).toHaveBeenCalledWith("/login", {
          replace: true,
          state: { passwordReset: true },
        }),
      );
      const [[, init]] = fetchCalls("/v1/auth/password-reset/confirm");
      expect(JSON.parse(String(init?.body))).toEqual({
        token: TOKEN,
        new_password: "a brand new password",
      });
      expect(logout).not.toHaveBeenCalled();
    });

    it("ends this tab's session after a reset, since the gateway revoked it", async () => {
      isAuthenticated = true;
      vi.mocked(fetch).mockResolvedValue(respond(204));
      openLink();
      fillAndSubmit("a brand new password");
      await vi.waitFor(() => expect(navigate).toHaveBeenCalled());
      expect(logout).toHaveBeenCalledTimes(1);
      expect(logout.mock.invocationCallOrder[0]).toBeLessThan(
        navigate.mock.invocationCallOrder[0],
      );
    });

    it("disables the form while saving", async () => {
      let resolve!: (r: Response) => void;
      vi.mocked(fetch).mockReturnValue(new Promise((r) => (resolve = r)));
      openLink();
      fillAndSubmit("a brand new password");
      expect(screen.getByRole("button", { name: "Saving…" }).hasAttribute("disabled")).toBe(true);
      resolve(respond(204));
      await vi.waitFor(() => expect(navigate).toHaveBeenCalled());
    });

    it("answers the generic token error with an inline new-link form", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        respond(400, { detail: "invalid_or_expired_token" }),
      );
      openLink();
      fillAndSubmit("a brand new password");

      const message = await screen.findByText("This reset link is invalid or has expired.");
      const problem = message.closest('[role="alert"]');
      expect(problem).not.toBeNull();
      expect(document.activeElement).toBe(problem);
      expect(screen.queryByLabelText("New password")).toBeNull();
      expect(navigate).not.toHaveBeenCalled();

      // "Send me a new link" calls the request endpoint and confirms.
      vi.mocked(fetch).mockResolvedValueOnce(respond(202, {}));
      fireEvent.change(screen.getByLabelText("Email"), {
        target: { value: "alice@example.com" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Send me a new link" }));
      expect((await screen.findByRole("status")).textContent).toContain(
        RESET_REQUEST_CONFIRMATION,
      );
      const [[, init]] = fetchCalls("/v1/auth/password-reset/request");
      expect(JSON.parse(String(init?.body))).toEqual({ email: "alice@example.com" });
      // The dead token is never sent again.
      expect(fetchCalls("/v1/auth/password-reset/confirm")).toHaveLength(1);
    });

    it.each([
      [429, /Too many attempts from this network\. Wait a minute/],
      [422, /didn't accept this password/],
      [404, /turned off on this server/],
    ])("keeps the form and the token after a %i", async (status, message) => {
      vi.mocked(fetch).mockResolvedValueOnce(respond(status, { detail: "x" }));
      openLink();
      fillAndSubmit("a brand new password");
      await screen.findByText(message);
      expect(screen.getByRole("alert").textContent).toMatch(message);
      expect(document.activeElement).toBe(screen.getByLabelText("New password"));

      // A retry sends the same token.
      vi.mocked(fetch).mockResolvedValueOnce(respond(204));
      fireEvent.click(screen.getByRole("button", { name: "Set new password" }));
      await vi.waitFor(() => expect(navigate).toHaveBeenCalled());
      const confirms = fetchCalls("/v1/auth/password-reset/confirm");
      expect(confirms).toHaveLength(2);
      expect(JSON.parse(String(confirms[1][1]?.body)).token).toBe(TOKEN);
    });

    it("reports a network failure and lets the user retry", async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
      openLink();
      fillAndSubmit("a brand new password");
      await screen.findByText(/Couldn't reach the server/);
      expect(screen.getByRole("button", { name: "Set new password" }).hasAttribute("disabled")).toBe(
        false,
      );
    });
  });
});
