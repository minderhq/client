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
    is_local: false,
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
          is_local: false,
        },
      }),
    );
  });

  it("creates a vLLM preset provider with is_local set automatically", async () => {
    // #1467: picking the vLLM preset must send adapter=openai_compatible
    // (the only backend concept vLLM maps to) plus is_local=true, without
    // the user ever seeing or setting either field directly.
    mockAuth = { token: "tok", role: "admin" };
    apiFetch.mockResolvedValueOnce([]); // initial list
    render(<CloudProvidersPage />);
    await screen.findByText("No cloud providers configured yet.");

    fireEvent.click(screen.getByText("Add Provider"));
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "vllm" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. vLLM (local)"), {
      target: { value: "My vLLM box" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("http://<your-vllm-host>:8000/v1"),
      { target: { value: "http://10.0.0.5:8000/v1" } },
    );
    const apiKeyInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(apiKeyInput, { target: { value: "not-required" } });

    apiFetch.mockResolvedValueOnce(provider({ name: "My vLLM box", is_local: true }));
    apiFetch.mockResolvedValueOnce([provider({ name: "My vLLM box", is_local: true })]);

    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/model-providers", {
        method: "POST",
        token: "tok",
        body: {
          adapter: "openai_compatible",
          name: "My vLLM box",
          base_url: "http://10.0.0.5:8000/v1",
          api_key: "not-required",
          is_local: true,
        },
      }),
    );
  });

  it("shows a self-hosted badge for an is_local provider", async () => {
    mockAuth = { token: "tok", role: "admin" };
    apiFetch.mockResolvedValueOnce([provider({ is_local: true })]);
    render(<CloudProvidersPage />);
    expect(await screen.findByText("self-hosted")).toBeTruthy();
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

  it("shows the test result via the status line", async () => {
    mockAuth = { token: "tok", role: "admin" };
    apiFetch.mockResolvedValueOnce([provider()]);
    render(<CloudProvidersPage />);
    await screen.findByText("OpenAI (production)");

    apiFetch.mockResolvedValueOnce({ ok: true, detail: "connection verified" });
    fireEvent.click(screen.getByText("Test"));

    expect(await screen.findByText("connection verified")).toBeTruthy();
    expect(apiFetch).toHaveBeenLastCalledWith("/v1/model-providers/p1/test", {
      method: "POST",
      token: "tok",
    });
  });

  it("shows a bad-key test result as an error, without a thrown exception", async () => {
    mockAuth = { token: "tok", role: "admin" };
    apiFetch.mockResolvedValueOnce([provider()]);
    render(<CloudProvidersPage />);
    await screen.findByText("OpenAI (production)");

    apiFetch.mockResolvedValueOnce({
      ok: false,
      detail: "authentication failed — check the API key",
    });
    fireEvent.click(screen.getByText("Test"));

    expect(
      await screen.findByText("authentication failed — check the API key"),
    ).toBeTruthy();
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
