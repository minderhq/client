import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CloudProvidersPage, type Provider } from "./CloudProvidersPage";

const apiFetch = vi.fn();
vi.mock("../lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  friendlyErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
}));

let mockAuth = { token: "", role: "" };
vi.mock("../lib/auth", () => ({
  useAuth: () => mockAuth,
}));

const mockConfirm = vi.fn();
vi.mock("../components/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: mockConfirm, dialog: null }),
}));

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: "p1",
    adapter: "openai_compatible",
    name: "OpenAI (production)",
    base_url: null,
    api_key_masked: "sk-...ab12",
    enabled: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("CloudProvidersPage", () => {
  afterEach(() => {
    cleanup();
    apiFetch.mockReset();
    mockConfirm.mockReset();
  });

  it("shows an admin-required message and never fetches for a non-admin", () => {
    mockAuth = { token: "tok", role: "member" };
    render(<CloudProvidersPage />);
    expect(
      screen.getByText("Admin role required to view or manage cloud providers."),
    ).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("prompts to log in when unauthenticated", () => {
    mockAuth = { token: "", role: "" };
    render(<CloudProvidersPage />);
    expect(
      screen.getByText("Log in as an admin to view or manage cloud providers."),
    ).toBeTruthy();
  });

  it("lists configured providers for an admin", async () => {
    mockAuth = { token: "tok", role: "admin" };
    apiFetch.mockResolvedValueOnce([
      provider({ name: "OpenAI (production)" }),
      provider({ id: "p2", name: "Claude", adapter: "anthropic", enabled: false }),
    ]);
    render(<CloudProvidersPage />);

    expect(await screen.findByText("OpenAI (production)")).toBeTruthy();
    expect(screen.getByText("Claude")).toBeTruthy();
    expect(screen.getByText("disabled")).toBeTruthy();
  });

  it("shows an empty state when no providers are configured", async () => {
    mockAuth = { token: "tok", role: "admin" };
    apiFetch.mockResolvedValueOnce([]);
    render(<CloudProvidersPage />);
    expect(
      await screen.findByText("No cloud providers configured yet."),
    ).toBeTruthy();
  });

  it("creates a provider via the add form", async () => {
    mockAuth = { token: "tok", role: "admin" };
    apiFetch.mockResolvedValueOnce([]); // initial list
    render(<CloudProvidersPage />);
    await screen.findByText("No cloud providers configured yet.");

    fireEvent.click(screen.getByText("Add Provider"));
    fireEvent.change(screen.getByPlaceholderText("e.g. OpenAI (production)"), {
      target: { value: "My Provider" },
    });
    fireEvent.change(screen.getByPlaceholderText("https://api.z.ai/api/paas/v4"), {
      target: { value: "https://api.example.com" },
    });
    const apiKeyInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(apiKeyInput, { target: { value: "secret-key" } });

    apiFetch.mockResolvedValueOnce(provider({ name: "My Provider" })); // create response
    apiFetch.mockResolvedValueOnce([provider({ name: "My Provider" })]); // reload

    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/model-providers", {
        method: "POST",
        token: "tok",
        body: {
          adapter: "openai_compatible",
          name: "My Provider",
          base_url: "https://api.example.com",
          api_key: "secret-key",
        },
      }),
    );
  });

  it("toggles a provider's enabled state", async () => {
    mockAuth = { token: "tok", role: "admin" };
    apiFetch.mockResolvedValueOnce([provider({ enabled: true })]);
    render(<CloudProvidersPage />);
    await screen.findByText("OpenAI (production)");

    apiFetch.mockResolvedValueOnce({}); // PATCH response
    apiFetch.mockResolvedValueOnce([provider({ enabled: false })]); // reload
    fireEvent.click(screen.getByText("Disable"));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/model-providers/p1", {
        method: "PATCH",
        token: "tok",
        body: { enabled: false },
      }),
    );
  });

  it("deletes a provider only after confirmation", async () => {
    mockAuth = { token: "tok", role: "admin" };
    apiFetch.mockResolvedValueOnce([provider()]);
    render(<CloudProvidersPage />);
    await screen.findByText("OpenAI (production)");

    mockConfirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByText("Delete"));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1));
    expect(apiFetch).toHaveBeenCalledTimes(1); // only the initial list call

    mockConfirm.mockResolvedValueOnce(true);
    apiFetch.mockResolvedValueOnce({}); // DELETE response
    apiFetch.mockResolvedValueOnce([]); // reload
    fireEvent.click(screen.getByText("Delete"));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/model-providers/p1", {
        method: "DELETE",
        token: "tok",
      }),
    );
  });

  it("surfaces a fetch error via the status line", async () => {
    mockAuth = { token: "tok", role: "admin" };
    apiFetch.mockRejectedValueOnce(new Error("model-management unreachable"));
    render(<CloudProvidersPage />);
    expect(await screen.findByText("model-management unreachable")).toBeTruthy();
  });
});
