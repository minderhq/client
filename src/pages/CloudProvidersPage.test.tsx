import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CloudProvidersPage,
  type Provider,
  type ProviderPreset,
} from "./CloudProvidersPage";

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
    privacy_acknowledged: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// Mirrors what GET /v1/model-providers/presets (#1585 / ProviderPresetOut)
// serves: hosted vendors first, then the vLLM local-compute entry and the
// generic custom endpoint. The add-provider dropdown is driven entirely by
// this backend list, so the tests mock it rather than any hardcoded client
// list.
const PRESETS: ProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    adapter: "openai_compatible",
    is_local: false,
    base_url_placeholder: null,
    requires_api_key: true,
    description: "OpenAI's hosted API (gpt-4o, o1, ...).",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    adapter: "anthropic",
    is_local: false,
    base_url_placeholder: null,
    requires_api_key: true,
    description: "Anthropic's hosted Claude models.",
  },
  {
    id: "vllm",
    label: "vLLM (self-hosted)",
    adapter: "openai_compatible",
    is_local: true,
    base_url_placeholder: "http://localhost:8000/v1",
    requires_api_key: false,
    description:
      "A self-hosted vLLM OpenAI-compatible server. Local compute with no per-call cost, so exempt from the cloud-provider rate limit.",
  },
  {
    id: "openai_compatible",
    label: "OpenAI-compatible (custom)",
    adapter: "openai_compatible",
    is_local: false,
    base_url_placeholder: "https://your-endpoint.example/v1",
    requires_api_key: true,
    description: "Any other endpoint speaking the OpenAI chat-completions API.",
  },
];

/** Route apiFetch by path + method so the two on-mount GETs (providers list +
 * presets) and any later mutation resolve independently of call order. */
function installApi(
  opts: {
    providers?: Provider[];
    presets?: ProviderPreset[];
    providersError?: Error;
    presetsError?: Error;
    testResult?: { ok: boolean; detail: string };
  } = {},
) {
  const {
    providers = [],
    presets = PRESETS,
    providersError,
    presetsError,
    testResult = { ok: true, detail: "connection verified" },
  } = opts;
  apiFetch.mockImplementation(
    (path: string, options: { method?: string } = {}) => {
      const method = options.method ?? "GET";
      if (path === "/v1/model-providers/presets") {
        return presetsError
          ? Promise.reject(presetsError)
          : Promise.resolve(presets);
      }
      if (path === "/v1/model-providers" && method === "GET") {
        return providersError
          ? Promise.reject(providersError)
          : Promise.resolve(providers);
      }
      if (path === "/v1/model-providers" && method === "POST") {
        return Promise.resolve(provider());
      }
      if (path.endsWith("/test")) return Promise.resolve(testResult);
      if (method === "PATCH") return Promise.resolve({});
      if (method === "DELETE") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    },
  );
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
    installApi({
      providers: [
        provider({ name: "OpenAI (production)" }),
        provider({ id: "p2", name: "Claude", adapter: "anthropic", enabled: false }),
      ],
    });
    render(<CloudProvidersPage />);

    expect(await screen.findByText("OpenAI (production)")).toBeTruthy();
    expect(screen.getByText("Claude")).toBeTruthy();
    expect(screen.getByText("disabled")).toBeTruthy();
  });

  it("shows an empty state when no providers are configured", async () => {
    mockAuth = { token: "tok", role: "admin" };
    installApi({ providers: [] });
    render(<CloudProvidersPage />);
    expect(
      await screen.findByText("No cloud providers configured yet."),
    ).toBeTruthy();
  });

  it("renders the add-provider dropdown from the presets endpoint", async () => {
    mockAuth = { token: "tok", role: "admin" };
    installApi({ providers: [] });
    render(<CloudProvidersPage />);
    await screen.findByText("No cloud providers configured yet.");

    // The preset list is fetched from the backend, not hardcoded.
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/model-providers/presets",
      expect.objectContaining({ token: "tok" }),
    );

    fireEvent.click(screen.getByText("Add Provider"));
    const select = await screen.findByRole("combobox");
    // The vLLM (self-hosted) preset is a first-class, labeled option (#1467).
    expect(screen.getByRole("option", { name: "vLLM (self-hosted)" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Anthropic" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "OpenAI-compatible (custom)" })).toBeTruthy();

    // Selecting a preset surfaces its backend-provided description.
    fireEvent.change(select, { target: { value: "vllm" } });
    expect(
      screen.getByText(
        "A self-hosted vLLM OpenAI-compatible server. Local compute with no per-call cost, so exempt from the cloud-provider rate limit.",
      ),
    ).toBeTruthy();
  });

  it("creates a provider from the default preset", async () => {
    mockAuth = { token: "tok", role: "admin" };
    installApi({ providers: [] });
    render(<CloudProvidersPage />);
    await screen.findByText("No cloud providers configured yet.");

    fireEvent.click(screen.getByText("Add Provider"));
    // Default (first) preset is OpenAI -> name placeholder is "e.g. OpenAI".
    const nameInput = await screen.findByPlaceholderText("e.g. OpenAI");
    fireEvent.change(nameInput, { target: { value: "My Provider" } });
    const apiKeyInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(apiKeyInput, { target: { value: "secret-key" } });

    // #1511: a cloud provider requires acknowledging the privacy tradeoff first.
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/model-providers", {
        method: "POST",
        token: "tok",
        body: {
          adapter: "openai_compatible",
          name: "My Provider",
          base_url: undefined,
          api_key: "secret-key",
          is_local: false,
          privacy_acknowledged: true,
        },
      }),
    );
  });

  it("creates a vLLM preset provider with adapter + is_local from the preset", async () => {
    // #1467: picking the vLLM preset must send adapter=openai_compatible (the
    // only backend concept vLLM maps to) plus is_local=true, both pre-filled
    // from the backend preset -- the user never sets either field directly.
    mockAuth = { token: "tok", role: "admin" };
    installApi({ providers: [] });
    render(<CloudProvidersPage />);
    await screen.findByText("No cloud providers configured yet.");

    fireEvent.click(screen.getByText("Add Provider"));
    fireEvent.change(await screen.findByRole("combobox"), {
      target: { value: "vllm" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. vLLM (self-hosted)"), {
      target: { value: "My vLLM box" },
    });
    // The base-URL placeholder is the preset's own hint from the backend.
    fireEvent.change(screen.getByPlaceholderText("http://localhost:8000/v1"), {
      target: { value: "http://10.0.0.5:8000/v1" },
    });
    const apiKeyInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(apiKeyInput, { target: { value: "not-required" } });

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
          // #1511: a self-hosted (is_local) provider never leaves the box, so no
          // acknowledgment is required or sent as acknowledged.
          privacy_acknowledged: false,
        },
      }),
    );
  });

  it("requires acknowledging the privacy tradeoff before a cloud provider can be added", async () => {
    // #1511: with a cloud preset selected the disclosure + acknowledgment
    // checkbox appear, and Add stays disabled until it's checked.
    mockAuth = { token: "tok", role: "admin" };
    installApi({ providers: [] });
    render(<CloudProvidersPage />);
    await screen.findByText("No cloud providers configured yet.");

    fireEvent.click(screen.getByText("Add Provider"));
    // Default (first) preset is OpenAI -- a cloud provider.
    await screen.findByPlaceholderText("e.g. OpenAI");
    expect(
      screen.getByText(
        /leaves your local\/self-hosted boundary and is subject to that provider's own data handling/,
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add" })).toHaveProperty(
      "disabled",
      true,
    );

    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Add" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("shows no acknowledgment checkbox for a self-hosted (local) provider", async () => {
    // #1511: an is_local preset never leaves the box, so the privacy
    // disclosure/checkbox must not appear and Add is immediately available.
    mockAuth = { token: "tok", role: "admin" };
    installApi({ providers: [] });
    render(<CloudProvidersPage />);
    await screen.findByText("No cloud providers configured yet.");

    fireEvent.click(screen.getByText("Add Provider"));
    fireEvent.change(await screen.findByRole("combobox"), {
      target: { value: "vllm" },
    });
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("prompts for acknowledgment when enabling a disabled, unacknowledged cloud provider", async () => {
    // #1511: enabling is the other activation point -- a disabled cloud row that
    // was never acknowledged must surface the disclosure via a confirm and send
    // privacy_acknowledged=true alongside enabled=true.
    mockAuth = { token: "tok", role: "admin" };
    installApi({
      providers: [provider({ enabled: false, privacy_acknowledged: false })],
    });
    render(<CloudProvidersPage />);
    await screen.findByText("OpenAI (production)");

    mockConfirm.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByText("Enable"));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/model-providers/p1", {
        method: "PATCH",
        token: "tok",
        body: { enabled: true, privacy_acknowledged: true },
      }),
    );
  });

  it("does not re-prompt when enabling an already-acknowledged cloud provider", async () => {
    mockAuth = { token: "tok", role: "admin" };
    installApi({
      providers: [provider({ enabled: false, privacy_acknowledged: true })],
    });
    render(<CloudProvidersPage />);
    await screen.findByText("OpenAI (production)");

    fireEvent.click(screen.getByText("Enable"));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/model-providers/p1", {
        method: "PATCH",
        token: "tok",
        body: { enabled: true },
      }),
    );
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("shows an error in the add form when the presets fail to load", async () => {
    mockAuth = { token: "tok", role: "admin" };
    installApi({
      providers: [],
      presetsError: new Error("model-management unreachable"),
    });
    render(<CloudProvidersPage />);
    await screen.findByText("No cloud providers configured yet.");

    fireEvent.click(screen.getByText("Add Provider"));
    expect(
      await screen.findByText("model-management unreachable"),
    ).toBeTruthy();
    // With no presets there is nothing to submit.
    expect(screen.getByRole("button", { name: "Add" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("shows a self-hosted badge for an is_local provider", async () => {
    mockAuth = { token: "tok", role: "admin" };
    installApi({ providers: [provider({ is_local: true })] });
    render(<CloudProvidersPage />);
    expect(await screen.findByText("self-hosted")).toBeTruthy();
  });

  it("toggles a provider's enabled state", async () => {
    mockAuth = { token: "tok", role: "admin" };
    installApi({ providers: [provider({ enabled: true })] });
    render(<CloudProvidersPage />);
    await screen.findByText("OpenAI (production)");

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
    installApi({
      providers: [provider()],
      testResult: { ok: true, detail: "connection verified" },
    });
    render(<CloudProvidersPage />);
    await screen.findByText("OpenAI (production)");

    fireEvent.click(screen.getByText("Test"));

    expect(await screen.findByText("connection verified")).toBeTruthy();
    expect(apiFetch).toHaveBeenLastCalledWith("/v1/model-providers/p1/test", {
      method: "POST",
      token: "tok",
    });
  });

  it("shows a bad-key test result as an error, without a thrown exception", async () => {
    mockAuth = { token: "tok", role: "admin" };
    installApi({
      providers: [provider()],
      testResult: {
        ok: false,
        detail: "authentication failed — check the API key",
      },
    });
    render(<CloudProvidersPage />);
    await screen.findByText("OpenAI (production)");

    fireEvent.click(screen.getByText("Test"));

    expect(
      await screen.findByText("authentication failed — check the API key"),
    ).toBeTruthy();
  });

  it("deletes a provider only after confirmation", async () => {
    mockAuth = { token: "tok", role: "admin" };
    installApi({ providers: [provider()] });
    render(<CloudProvidersPage />);
    await screen.findByText("OpenAI (production)");

    mockConfirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByText("Delete"));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1));
    expect(apiFetch).not.toHaveBeenCalledWith("/v1/model-providers/p1", {
      method: "DELETE",
      token: "tok",
    });

    mockConfirm.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByText("Delete"));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/model-providers/p1", {
        method: "DELETE",
        token: "tok",
      }),
    );
  });

  it("renames a provider via PATCH name", async () => {
    // #1718: rename is a first-class inline edit reusing the existing PATCH
    // endpoint's `name` field -- no delete-and-recreate.
    mockAuth = { token: "tok", role: "admin" };
    installApi({ providers: [provider({ name: "OpenAI (production)" })] });
    render(<CloudProvidersPage />);
    await screen.findByText("OpenAI (production)");

    fireEvent.click(screen.getByText("Rename"));
    const nameInput = await screen.findByLabelText("New provider name");
    fireEvent.change(nameInput, { target: { value: "OpenAI (staging)" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/model-providers/p1", {
        method: "PATCH",
        token: "tok",
        body: { name: "OpenAI (staging)" },
      }),
    );
  });

  it("does not send a rename request when the name is unchanged", async () => {
    // A blank/unchanged rename just closes the form -- no pointless PATCH.
    mockAuth = { token: "tok", role: "admin" };
    installApi({ providers: [provider({ name: "OpenAI (production)" })] });
    render(<CloudProvidersPage />);
    await screen.findByText("OpenAI (production)");

    fireEvent.click(screen.getByText("Rename"));
    await screen.findByLabelText("New provider name");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.queryByLabelText("New provider name")).toBeNull(),
    );
    expect(apiFetch).not.toHaveBeenCalledWith(
      "/v1/model-providers/p1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("rotates a provider's API key via PATCH api_key", async () => {
    // #1718: rotating replaces the stored key on the SAME provider row (keeps
    // its id, so routed models keep working) -- the old delete-and-recreate is
    // gone. The new key is write-only, sent via the existing PATCH `api_key`.
    mockAuth = { token: "tok", role: "admin" };
    installApi({ providers: [provider()] });
    render(<CloudProvidersPage />);
    await screen.findByText("OpenAI (production)");

    fireEvent.click(screen.getByText("Rotate key"));
    const keyInput = await screen.findByLabelText("New API key");
    // The current key is never pre-filled -- the rotate form starts empty so it
    // can only ever SET a new key, never reveal the stored one.
    expect((keyInput as HTMLInputElement).value).toBe("");
    fireEvent.change(keyInput, { target: { value: "sk-new-secret-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Rotate" }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/model-providers/p1", {
        method: "PATCH",
        token: "tok",
        body: { api_key: "sk-new-secret-key" },
      }),
    );
  });

  it("keeps the rotate submit disabled until a new key is entered", async () => {
    mockAuth = { token: "tok", role: "admin" };
    installApi({ providers: [provider()] });
    render(<CloudProvidersPage />);
    await screen.findByText("OpenAI (production)");

    fireEvent.click(screen.getByText("Rotate key"));
    await screen.findByLabelText("New API key");
    expect(screen.getByRole("button", { name: "Rotate" })).toHaveProperty(
      "disabled",
      true,
    );

    fireEvent.change(screen.getByLabelText("New API key"), {
      target: { value: "sk-new" },
    });
    expect(screen.getByRole("button", { name: "Rotate" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("surfaces a fetch error via the status line", async () => {
    mockAuth = { token: "tok", role: "admin" };
    installApi({ providersError: new Error("model-management unreachable") });
    render(<CloudProvidersPage />);
    expect(await screen.findByText("model-management unreachable")).toBeTruthy();
  });
});
