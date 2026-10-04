import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LoginPage } from "./LoginPage";

// The real capabilities hooks, with only the network call mocked: the page
// must read password reset AND the registration mode from one request.
const apiFetch = vi.fn();
vi.mock("../lib/api", async () => ({
  ...(await vi.importActual<typeof import("../lib/api")>("../lib/api")),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  oidcLoginUrl: "",
}));
vi.mock("../lib/auth", () => ({
  useAuth: () => ({ isAuthenticated: false, login: vi.fn(), register: vi.fn() }),
}));

function capabilityCalls() {
  return apiFetch.mock.calls.filter(([path]) => path === "/v1/auth/capabilities");
}

describe("LoginPage capabilities", () => {
  afterEach(() => {
    cleanup();
    apiFetch.mockReset();
  });

  it.each([
    ["open", "Create one"],
    ["invite", /created by invitation/],
    ["closed", /Sign-up is turned off/],
    ["sso_only", /Sign-up is turned off/],
    ["something-new", /created by invitation/],
  ])("makes one request and follows registration_mode %j", async (mode, text) => {
    apiFetch.mockResolvedValue({
      password_reset_email: true,
      email_verification: false,
      registration_mode: mode,
    });
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <LoginPage />
      </MemoryRouter>,
    );
    await screen.findByRole("link", { name: "Forgot password?" });
    expect(await screen.findAllByText(text)).not.toHaveLength(0);
    expect(capabilityCalls()).toHaveLength(1);
  });

  it("offers sign-up and no reset link when an older API has neither field", async () => {
    apiFetch.mockResolvedValue({});
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <LoginPage />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "Create one" });
    expect(screen.queryByRole("link", { name: "Forgot password?" })).toBeNull();
    expect(capabilityCalls()).toHaveLength(1);
  });
});
