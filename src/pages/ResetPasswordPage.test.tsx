import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PASSWORD_RESET_DONE, ResetPasswordPage } from "./ResetPasswordPage";

let isAuthenticated = false;
const logout = vi.fn(() => {
  isAuthenticated = false;
});
vi.mock("../lib/auth", () => ({
  useAuth: () => ({ isAuthenticated, username: "alice", logout }),
}));

function respond(status: number, body?: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function LoginStub() {
  const state = useLocation().state as { notice?: string; username?: string } | null;
  return (
    <p data-testid="login" data-username={state?.username ?? ""}>
      {state?.notice}
    </p>
  );
}

function renderAt(url: string) {
  // The page reads the token from the real address bar, like in a browser.
  window.history.replaceState(null, "", url);
  return render(
    <MemoryRouter initialEntries={["/reset-password"]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/login" element={<LoginStub />} />
      </Routes>
    </MemoryRouter>,
  );
}

function fill(password: string, confirm = password) {
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: confirm } });
}

const submit = () => fireEvent.click(screen.getByRole("button", { name: "Set new password" }));

describe("ResetPasswordPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    logout.mockClear();
    isAuthenticated = false;
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("clears the token from the address bar and sends nothing on load", async () => {
    renderAt("/reset-password#token=secret-token");
    await screen.findByLabelText("New password");
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("secret-token");
    expect(fetch).not.toHaveBeenCalled();
    expect(document.querySelector('meta[name="referrer"]')?.getAttribute("content")).toBe(
      "no-referrer",
    );
    cleanup();
    expect(document.querySelector('meta[name="referrer"]')).toBeNull();
  });

  it("points to a new link when the URL carries no token", async () => {
    renderAt("/reset-password");
    const link = await screen.findByRole("link", { name: "Request a new link" });
    expect(link.getAttribute("href")).toBe("/forgot-password");
    expect(screen.queryByLabelText("New password")).toBeNull();
  });

  it("refuses a password over 72 bytes before sending it", async () => {
    renderAt("/reset-password#token=t");
    await screen.findByLabelText("New password");
    // 37 characters, but 74 bytes in UTF-8.
    fill("é".repeat(37));
    expect(screen.getByRole("alert").textContent).toMatch(/under 72 bytes/);
    expect(screen.getByRole("button", { name: "Set new password" }).hasAttribute("disabled")).toBe(
      true,
    );
    submit();
    expect(fetch).not.toHaveBeenCalled();

    // Exactly 72 bytes is accepted.
    fill("é".repeat(36));
    expect(screen.getByRole("alert").textContent).toBe("");
    expect(screen.getByRole("button", { name: "Set new password" }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("counts the minimum length in characters as the gateway does, not UTF-16 units", async () => {
    renderAt("/reset-password#token=t");
    await screen.findByLabelText("New password");
    // Four emoji: 8 UTF-16 units, but 4 characters, which the gateway refuses.
    fill("\u{1F600}".repeat(4));
    submit();
    expect((await screen.findByRole("alert")).textContent).toMatch(/at least 8 characters/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("checks the confirmation matches", async () => {
    renderAt("/reset-password#token=t");
    await screen.findByLabelText("New password");
    fill("long enough 1", "long enough 2");
    submit();
    expect((await screen.findByRole("alert")).textContent).toMatch(/don't match/);
    // Focus moves to the field to fix, which points at the message.
    const confirmField = screen.getByLabelText("Confirm new password");
    expect(document.activeElement).toBe(confirmField);
    expect(confirmField.getAttribute("aria-invalid")).toBe("true");
    expect(confirmField.getAttribute("aria-describedby")).toContain("reset-password-error");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("on 204 goes to login with a success notice, without signing in", async () => {
    vi.mocked(fetch).mockResolvedValue(respond(204));
    renderAt("/reset-password#token=the-token");
    await screen.findByLabelText("New password");
    fill("new password 123");
    submit();
    expect((await screen.findByTestId("login")).textContent).toBe(PASSWORD_RESET_DONE);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toMatch(/\/v1\/auth\/password-reset\/confirm$/);
    expect(JSON.parse(init?.body as string)).toEqual({
      token: "the-token",
      new_password: "new password 123",
    });
    expect(sessionStorage.getItem("minder_jwt")).toBeNull();
    expect(logout).not.toHaveBeenCalled();
  });

  it("asks a signed-in user to sign out first, then continues", async () => {
    isAuthenticated = true;
    vi.mocked(fetch).mockResolvedValue(respond(204));
    renderAt("/reset-password#token=t");
    await screen.findByText(/You're signed in/);
    expect(screen.getByText("alice")).toBeTruthy();
    expect(screen.queryByLabelText("New password")).toBeNull();
    expect(window.location.hash).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Sign out and continue" }));
    expect(logout).toHaveBeenCalledTimes(1);
    const field = await screen.findByLabelText("New password");
    expect(document.activeElement).toBe(field);

    fill("new password 123");
    submit();
    const login = await screen.findByTestId("login");
    expect(login.textContent).toBe(PASSWORD_RESET_DONE);
    // Who was signed in is known, so the login form can be prefilled.
    expect(login.dataset.username).toBe("alice");
  });

  it("lets a signed-in user cancel without signing out", async () => {
    isAuthenticated = true;
    renderAt("/reset-password#token=t");
    const cancel = await screen.findByRole("link", { name: "Cancel" });
    expect(cancel.getAttribute("href")).toBe("/");
    expect(logout).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows and hides both password fields", async () => {
    renderAt("/reset-password#token=t");
    const field = await screen.findByLabelText("New password");
    expect(field.getAttribute("type")).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Show passwords" }));
    expect(field.getAttribute("type")).toBe("text");
    expect(screen.getByLabelText("Confirm new password").getAttribute("type")).toBe("text");
    const toggle = screen.getByRole("button", { name: "Hide passwords" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle);
    expect(field.getAttribute("type")).toBe("password");
  });

  it("on 400 invalid_or_expired_token offers to send a new link in place", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(respond(400, { detail: "invalid_or_expired_token" }));
    renderAt("/reset-password#token=t");
    await screen.findByLabelText("New password");
    fill("new password 123");
    submit();
    const notice = await screen.findByText(/invalid or has expired/);
    expect(document.activeElement?.contains(notice)).toBe(true);
    expect(screen.queryByText("invalid_or_expired_token")).toBeNull();
    expect(screen.queryByLabelText("New password")).toBeNull();

    vi.mocked(fetch).mockResolvedValueOnce(respond(202, { detail: "accepted" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send me a new link" }));
    await screen.findByText(/If an account exists for that address/);
    const [url, init] = vi.mocked(fetch).mock.calls[1];
    expect(String(url)).toMatch(/\/password-reset\/request$/);
    expect(JSON.parse(init?.body as string)).toEqual({ email: "a@example.com" });
  });

  it("prefills the new-link form with the address used earlier in this tab", async () => {
    sessionStorage.setItem("minder_password_reset_email", "me@example.com");
    vi.mocked(fetch).mockResolvedValueOnce(respond(400, { detail: "invalid_or_expired_token" }));
    renderAt("/reset-password#token=t");
    await screen.findByLabelText("New password");
    fill("new password 123");
    submit();
    await screen.findByText(/invalid or has expired/);
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("me@example.com");
    // One click sends the new link.
    vi.mocked(fetch).mockResolvedValueOnce(respond(202, { detail: "accepted" }));
    fireEvent.click(screen.getByRole("button", { name: "Send me a new link" }));
    await screen.findByText(/If an account exists for that address/);
  });

  it("forgets the remembered address once the reset succeeds", async () => {
    sessionStorage.setItem("minder_password_reset_email", "me@example.com");
    vi.mocked(fetch).mockResolvedValue(respond(204));
    renderAt("/reset-password#token=t");
    await screen.findByLabelText("New password");
    fill("new password 123");
    submit();
    expect((await screen.findByTestId("login")).dataset.username).toBe("");
    expect(sessionStorage.getItem("minder_password_reset_email")).toBeNull();
  });

  it("keeps the form on a rate limit (429)", async () => {
    vi.mocked(fetch).mockResolvedValue(respond(429, { detail: "Too many requests" }));
    renderAt("/reset-password#token=t");
    await screen.findByLabelText("New password");
    fill("new password 123");
    submit();
    expect((await screen.findByRole("alert")).textContent).toMatch(/Wait a minute/);
    expect(screen.getByLabelText("New password")).toBeTruthy();
  });
});
