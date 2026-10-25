import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import { myPermissions, SERVER_SESSION, serveMyPermissions } from "../test/myPermissions";

import {
  CloudProvidersPage,
  type Provider,
  type ProviderPreset,
} from "./CloudProvidersPage";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  // The real ApiError, so fetch-models error handling can switch on `status`.
  ApiError: (await importOriginal<typeof import("../lib/api")>()).ApiError,
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  friendlyErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
}));

let mockAuth: {
  token: string;
  role: string;
  orgRole?: string;
  isAuthenticated?: boolean;
  isPlatformAdmin?: boolean;
} = {
  token: "",
  role: "",
};
vi.mock("../lib/auth", () => ({
  useAuth: () => mockAuth,
}));

// The Defaults section has its own tests (ModelDefaultsPanel.test.tsx); here a
// stub just records how the page mounts it.
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
    pii_masking_enabled: true,
    models: [],
    effective_models: ["gpt-4o", "gpt-4o-mini"],
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
    suggested_models: [],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    adapter: "anthropic",
    is_local: false,
    base_url_placeholder: null,
    requires_api_key: true,
    description: "Anthropic's hosted Claude models.",
    suggested_models: [],
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
    suggested_models: [],
  },
  {
    id: "zai",
    label: "z.ai (GLM)",
    adapter: "openai_compatible",
    is_local: false,
    base_url_placeholder: "https://api.z.ai/api/paas/v4",
    requires_api_key: true,
    description: "z.ai's GLM models through its OpenAI-compatible API.",
    suggested_models: ["glm-4.6", "glm-4.5-air"],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    adapter: "openai_compatible",
    is_local: false,
    base_url_placeholder: "https://openrouter.ai/api/v1",
    requires_api_key: true,
    description: "Many vendors' models through one OpenAI-compatible API.",
    suggested_models: [],
  },
  {
    id: "openai_compatible",
    label: "OpenAI-compatible (custom)",
    adapter: "openai_compatible",
    is_local: false,
    base_url_placeholder: "https://your-endpoint.example/v1",
    requires_api_key: true,
    description: "Any other endpoint speaking the OpenAI chat-completions API.",
    suggested_models: [],
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
    fetchModels?: { models: string[]; source: string } | Error;
  } = {},
) {
  const {
    providers = [],
    presets = PRESETS,
    providersError,
    presetsError,
    testResult = { ok: true, detail: "connection verified" },
    fetchModels = { models: [], source: "vendor" },
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
      if (path.endsWith("/fetch-models")) {
        return fetchModels instanceof Error
          ? Promise.reject(fetchModels)
          : Promise.resolve(fetchModels);
      }
      if (method === "PATCH") return Promise.resolve({});
      if (method === "DELETE") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    },
  );
}

// The cloud privacy acknowledgment (the add form also has a PII-masking box).
const ackCheckbox = () => screen.getByRole("checkbox", { name: /I understand/ });

async function openAddForm(presetId: string) {
  render(<CloudProvidersPage />);
  await screen.findByText("No cloud providers configured yet.");
  fireEvent.click(screen.getByText("Add Provider"));
  fireEvent.change(await screen.findByRole("combobox"), { target: { value: presetId } });
}

const LOCAL_PRESET: ProviderPreset = {
  id: "lmstudio",
  label: "LM Studio (self-hosted)",
  adapter: "openai_compatible",
  is_local: true,
  base_url_placeholder: "http://192.168.1.50:1234/v1",
  requires_api_key: false,
  description: "LM Studio's local server.",
  suggested_models: [],
};

describe("CloudProvidersPage self-hosted servers", () => {
  afterEach(() => {
    cleanup();
    apiFetch.mockReset();
  });

  const keyInput = () => document.querySelector('input[type="password"]') as HTMLInputElement;

  it("makes the API key optional for a local preset and sends none when blank", async () => {
    mockAuth = { token: "tok", role: "admin" };
    installApi({ presets: [...PRESETS, LOCAL_PRESET] });
    await openAddForm("lmstudio");
    expect(screen.getByText("(optional)")).toBeTruthy();
    expect(keyInput().required).toBe(false);
    expect(screen.queryByText(/any non-empty value works/)).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("e.g. LM Studio (self-hosted)"), {
      target: { value: "LM Studio" },
    });
    fireEvent.change(screen.getByPlaceholderText("http://192.168.1.50:1234/v1"), {
      target: { value: "http://192.168.1.50:1234/v1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/v1/model-providers",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const post = apiFetch.mock.calls.find(([, o]) => o?.method === "POST");
    expect(post?.[1].body).toMatchObject({ adapter: "openai_compatible", is_local: true });
    expect(post?.[1].body.api_key).toBeUndefined();
  });

  it("keeps the API key required for a cloud preset", async () => {
    mockAuth = { token: "tok", role: "admin" };
    installApi();
    await openAddForm("openai_compatible");
    expect(screen.queryByText("(optional)")).toBeNull();
    expect(keyInput().required).toBe(true);
  });

  it("explains loopback for localhost but not for a LAN IP", async () => {
    mockAuth = { token: "tok", role: "admin" };
    installApi();
    await openAddForm("vllm");
    const url = screen.getByPlaceholderText("http://localhost:8000/v1");
    const hint = /use your machine's LAN IP or host.docker.internal, not localhost/;
    fireEvent.change(url, { target: { value: "http://localhost:8000/v1" } });
    expect(screen.getByText(hint)).toBeTruthy();
    fireEvent.change(url, { target: { value: "http://192.168.1.50:8000/v1" } });
    expect(screen.queryByText(hint)).toBeNull();
  });

  it("warns that a local row with no models won't show in pickers", async () => {
    mockAuth = { token: "tok", role: "admin" };
    installApi();
    await openAddForm("vllm");
    expect(screen.getByText(/won't appear in model pickers until you fetch them/)).toBeTruthy();
  });

  it("notes when a row is served by a different adapter", async () => {
    mockAuth = { token: "tok", role: "admin" };
    installApi({
      providers: [
        provider({
          is_local: true,
          base_url: "http://192.168.1.50:11434/v1",
          effective_adapter: "ollama",
        }),
        provider({ id: "p2", name: "Plain", effective_adapter: "openai_compatible" }),
      ],
    });
    render(<CloudProvidersPage />);
    expect(await screen.findByText("Served by the Ollama adapter (port 11434)")).toBeTruthy();
    expect(screen.getAllByText(/Served by the/)).toHaveLength(1);
  });

  it("sends PII masking on create for a cloud preset and hides it for a local one", async () => {
    mockAuth = { token: "tok", role: "admin" };
    installApi();
    await openAddForm("openai_compatible");
    const pii = screen.getByRole("checkbox", { name: /Mask personal data/ });
    expect((pii as HTMLInputElement).checked).toBe(true);
    fireEvent.click(pii);
    fireEvent.change(screen.getByPlaceholderText("e.g. OpenAI-compatible (custom)"), {
      target: { value: "Custom" },
    });
    fireEvent.change(keyInput(), { target: { value: "k" } });
    fireEvent.click(ackCheckbox());
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/v1/model-providers",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({ pii_masking_enabled: false }),
        }),
      ),
    );

    fireEvent.click(screen.getByText("Add Provider"));
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "vllm" } });
    expect(screen.queryByRole("checkbox", { name: /Mask personal data/ })).toBeNull();
  });

  it("toggles PII masking on a cloud row via PATCH, and hides it on a local row", async () => {
    mockAuth = { token: "tok", role: "admin" };
    installApi({
      providers: [provider(), provider({ id: "v", name: "vLLM box", is_local: true })],
    });
    render(<CloudProvidersPage />);
    await screen.findByText("vLLM box");
    const boxes = screen.getAllByRole("checkbox", { name: /Mask personal data/ });
    expect(boxes).toHaveLength(1);
    fireEvent.click(boxes[0]);
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/model-providers/p1", {
        method: "PATCH",
        token: "tok",
        body: { pii_masking_enabled: false },
      }),
    );
  });
});

describe("CloudProvidersPage", () => {
  afterEach(() => {
    cleanup();
    apiFetch.mockReset();
    mockConfirm.mockReset();
  });

  it("shows an owner/admin-required message and never fetches providers for a plain member", () => {
    mockAuth = { token: "tok", role: "member" };
    render(<CloudProvidersPage />);
    expect(
      screen.getByText("Only the organization's owners and admins can view or manage providers."),
    ).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("lets an org owner manage providers without being an instance admin", async () => {
    mockAuth = { token: "tok", role: "member", orgRole: "owner", isAuthenticated: true };
    installApi({
      providers: [
        provider({ id: "cloud", is_local: false }),
        provider({ id: "box", name: "Box", is_local: true }),
      ],
    });
    render(<CloudProvidersPage />);
    // The default models moved to their own tab (Organization › AI › Model defaults).
    expect(screen.queryByRole("region", { name: "Default models" })).toBeNull();
    // model-management's require_admin_or_org_admin lets an org owner/admin
    // manage the org's providers, so the client offers it too.
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/model-providers/presets", expect.anything()),
    );
    expect(
      screen.queryByText("Only the organization's owners and admins can view or manage providers."),
    ).toBeNull();
  });

  it("lets an org admin manage providers too", async () => {
    mockAuth = { token: "tok", role: "member", orgRole: "admin", isAuthenticated: true };
    installApi({ providers: [] });
    render(<CloudProvidersPage />);
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/model-providers/presets", expect.anything()),
    );
    expect(
      screen.queryByText("Only the organization's owners and admins can view or manage providers."),
    ).toBeNull();
  });

  it("keeps providers hidden from an org member", () => {
    mockAuth = { token: "tok", role: "member", orgRole: "member", isAuthenticated: true };
    render(<CloudProvidersPage />);
    expect(
      screen.getByText("Only the organization's owners and admins can view or manage providers."),
    ).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("mirrors the server gate: a custom role holding org.ai.manage, not owner/admin, gets no providers", () => {
    mockAuth = { token: "tok", role: "member", orgRole: "Knowledge manager", ...SERVER_SESSION };
    installApi({ providers: [] });
    serveMyPermissions(apiFetch, myPermissions({ orgKeys: ["org.ai.manage"] }));
    render(<CloudProvidersPage />);
    expect(
      screen.getByText("Only the organization's owners and admins can view or manage providers."),
    ).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("gives a Platform Admin who isn't an org owner/admin no provider controls", () => {
    mockAuth = { token: "tok", role: "member", orgRole: "member", isAuthenticated: true, isPlatformAdmin: true };
    render(<CloudProvidersPage />);
    expect(
      screen.getByText("Only the organization's owners and admins can view or manage providers."),
    ).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("warns on a provider whose base URL breaks the network policy", async () => {
    // #2548: policy_error = why the stored row violates the current egress
    // policy; every call through it is refused.
    mockAuth = { token: "tok", role: "admin" };
    installApi({
      providers: [
        provider({ policy_error: "base_url resolves to a private address." }),
        provider({ id: "p2", name: "Fine", policy_error: null }),
      ],
    });
    render(<CloudProvidersPage />);
    expect(await screen.findByText("Blocked by the network policy")).toBeTruthy();
    expect(screen.getByText(/base_url resolves to a private address\./)).toBeTruthy();
    expect(screen.getAllByText("blocked")).toHaveLength(1);
  });

  it("shows the backend's reason when creating a provider is refused (422)", async () => {
    mockAuth = { token: "tok", role: "admin" };
    installApi({ providers: [] });
    const route = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path: string, options: { method?: string } = {}) =>
      path === "/v1/model-providers" && options.method === "POST"
        ? Promise.reject(
            new ApiError("self-hosted providers are not allowed on this installation", 422),
          )
        : route(path, options),
    );
    render(<CloudProvidersPage />);
    await screen.findByText("No cloud providers configured yet.");

    fireEvent.click(screen.getByText("Add Provider"));
    fireEvent.change(await screen.findByRole("combobox"), {
      target: { value: "vllm" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. vLLM (self-hosted)"), {
      target: { value: "Box" },
    });
    fireEvent.change(screen.getByPlaceholderText("http://localhost:8000/v1"), {
      target: { value: "http://10.0.0.5:8000/v1" },
    });
    const apiKeyInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(apiKeyInput, { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(
      await screen.findByText(
        "The provider was refused: self-hosted providers are not allowed on this installation",
      ),
    ).toBeTruthy();
  });

  it("prompts to log in when unauthenticated", () => {
    mockAuth = { token: "", role: "" };
    render(<CloudProvidersPage />);
    expect(
      screen.getByText("Log in as an organization owner or admin to view or manage providers."),
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
    fireEvent.click(ackCheckbox());
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
          pii_masking_enabled: true,
          models: [],
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
          pii_masking_enabled: true,
          models: [],
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

    fireEvent.click(ackCheckbox());
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

  // ---------------------------------------------------------------------------
  // #2522: per-provider model lists, Fetch models, z.ai / OpenRouter presets
  // ---------------------------------------------------------------------------

  async function openAddForm() {
    await screen.findByText("No cloud providers configured yet.");
    fireEvent.click(screen.getByText("Add Provider"));
    return screen.findByRole("combobox");
  }

  function chips(): string[] {
    const list = screen.queryByRole("list", { name: "Selected models" });
    return list
      ? Array.from(list.querySelectorAll("li")).map((li) => li.textContent ?? "")
      : [];
  }

  it("offers the z.ai and OpenRouter presets and pre-fills suggested models", async () => {
    mockAuth = { token: "tok", role: "admin" };
    installApi({ providers: [] });
    render(<CloudProvidersPage />);
    const select = await openAddForm();

    expect(screen.getByRole("option", { name: "z.ai (GLM)" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "OpenRouter" })).toBeTruthy();
    expect(chips()).toEqual([]);

    fireEvent.change(select, { target: { value: "zai" } });
    expect(chips()).toEqual(["glm-4.6", "glm-4.5-air"]);
    expect(screen.getByPlaceholderText("https://api.z.ai/api/paas/v4")).toBeTruthy();

    // Switching preset re-fills from the new preset's suggestions.
    fireEvent.change(select, { target: { value: "openrouter" } });
    expect(chips()).toEqual([]);
  });

  it("adds, removes and validates model ids in the editor, and sends them on create", async () => {
    mockAuth = { token: "tok", role: "admin" };
    installApi({ providers: [] });
    render(<CloudProvidersPage />);
    fireEvent.change(await openAddForm(), { target: { value: "zai" } });

    const input = screen.getByLabelText("Add model id");
    // Enter adds the trimmed id (and must not submit the form).
    fireEvent.change(input, { target: { value: "  glm-4-plus " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(chips()).toEqual(["glm-4.6", "glm-4.5-air", "glm-4-plus"]);
    expect(apiFetch).not.toHaveBeenCalledWith(
      "/v1/model-providers",
      expect.objectContaining({ method: "POST" }),
    );

    // A duplicate, an id with a space and an over-long id are each rejected.
    fireEvent.change(input, { target: { value: "glm-4.6" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toContain("already in the list");
    fireEvent.change(input, { target: { value: "glm 4" } });
    fireEvent.click(screen.getByRole("button", { name: "Add model" }));
    expect(screen.getByRole("alert").textContent).toContain("spaces");
    fireEvent.change(input, { target: { value: "x".repeat(201) } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toContain("200 characters");
    expect(chips()).toHaveLength(3);

    // Remove via the chip's button, and via Backspace in the empty input.
    fireEvent.click(screen.getByRole("button", { name: "Remove model glm-4.5-air" }));
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(chips()).toEqual(["glm-4.6"]);

    fireEvent.change(screen.getByPlaceholderText("e.g. z.ai (GLM)"), {
      target: { value: "GLM" },
    });
    fireEvent.change(
      document.querySelector('input[type="password"]') as HTMLInputElement,
      { target: { value: "zai-key" } },
    );
    fireEvent.click(ackCheckbox());
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/v1/model-providers",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({ models: ["glm-4.6"] }),
        }),
      ),
    );
  });

  it("keeps only the rejected remainder in the input when a later id is a duplicate", async () => {
    mockAuth = { token: "tok", role: "admin" };
    installApi({ providers: [] });
    render(<CloudProvidersPage />);
    await openAddForm();

    const input = screen.getByLabelText("Add model id") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "a, a, b" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(chips()).toEqual(["a"]);
    expect(screen.getByRole("alert").textContent).toContain("already in the list");
    // The remainder starts at the rejected (second) "a", not the first one.
    expect(input.value).toBe("a, b");

    // Fixing the remainder and retrying makes progress instead of looping.
    fireEvent.change(input, { target: { value: "b" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(chips()).toEqual(["a", "b"]);
    expect(input.value).toBe("");
  });

  it("explains that an empty list falls back to the built-in catalog", async () => {
    mockAuth = { token: "tok", role: "admin" };
    installApi({ providers: [provider({ models: [], effective_models: ["gpt-4o", "o1"] })] });
    render(<CloudProvidersPage />);
    await screen.findByText("OpenAI (production)");

    fireEvent.click(screen.getByText("Edit models"));
    expect(chips()).toEqual([]);
    expect(screen.getByText(/Empty = use the built-in catalog \(2 models\)/)).toBeTruthy();
  });

  it("de-duplicates fetched ids and enables Select all/none only when they'd change something", async () => {
    mockAuth = { token: "tok", role: "admin" };
    installApi({
      providers: [provider()],
      fetchModels: { models: ["m1", "m2", "m1"], source: "vendor" },
    });
    render(<CloudProvidersPage />);
    await screen.findByText("OpenAI (production)");

    fireEvent.click(screen.getByRole("button", { name: "Fetch models" }));
    const found = await screen.findByText("2 models found");
    expect(found.getAttribute("role")).toBe("status");
    expect(
      screen.getByRole("list", { name: "Fetched models" }).querySelectorAll("li"),
    ).toHaveLength(2);

    const all = screen.getByRole("button", { name: "Select all" }) as HTMLButtonElement;
    const none = screen.getByRole("button", { name: "Select none" }) as HTMLButtonElement;
    expect(all.disabled).toBe(false);
    expect(none.disabled).toBe(true);
    fireEvent.click(all);
    expect(all.disabled).toBe(true);
    expect(none.disabled).toBe(false);
    fireEvent.click(none);
    expect(none.disabled).toBe(true);
  });

  it("shows a row's model count and first few models", async () => {
    mockAuth = { token: "tok", role: "admin" };
    installApi({
      providers: [
        provider({ effective_models: ["m1", "m2", "m3", "m4", "m5", "m6"] }),
      ],
    });
    render(<CloudProvidersPage />);
    expect(await screen.findByText(/6 models/)).toBeTruthy();
    expect(screen.getByText("m4")).toBeTruthy();
    expect(screen.queryByText("m5")).toBeNull();
    expect(screen.getByText("+2 more")).toBeTruthy();
  });

  it("warns 'Set models' only on a non-local row with no effective models", async () => {
    mockAuth = { token: "tok", role: "admin" };
    installApi({
      providers: [
        provider({ id: "z", name: "z.ai", effective_models: [] }),
        provider({ id: "v", name: "vLLM box", is_local: true, effective_models: [] }),
      ],
    });
    render(<CloudProvidersPage />);
    await screen.findByText("z.ai");
    expect(screen.getAllByText("Set models")).toHaveLength(1);
    expect(screen.getByText(/This provider has no models/)).toBeTruthy();
  });

  it("fetches models, merges the selected ones and saves them via PATCH models", async () => {
    mockAuth = { token: "tok", role: "admin" };
    installApi({
      providers: [provider({ id: "z", name: "z.ai", effective_models: [] })],
      fetchModels: {
        models: ["glm-4.6", "glm-4.5-air", "glm-4.5-flash"],
        source: "vendor",
      },
    });
    render(<CloudProvidersPage />);
    await screen.findByText("Set models");

    fireEvent.click(screen.getByRole("button", { name: "Fetch models" }));
    await screen.findByText("3 models found");
    expect(apiFetch).toHaveBeenCalledWith("/v1/model-providers/z/fetch-models", {
      method: "POST",
      token: "tok",
    });

    // Select all, then untick one.
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "glm-4.5-flash" }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected (2)" }));
    expect(chips()).toEqual(["glm-4.6", "glm-4.5-air"]);

    fireEvent.click(screen.getByRole("button", { name: "Save models" }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/model-providers/z", {
        method: "PATCH",
        token: "tok",
        body: { models: ["glm-4.6", "glm-4.5-air"] },
      }),
    );
  });

  it("filters a long fetched list and keeps already-added ids locked", async () => {
    mockAuth = { token: "tok", role: "admin" };
    const many = Array.from({ length: 12 }, (_, i) => `vendor/model-${i}`);
    installApi({
      providers: [
        provider({ models: ["vendor/model-0"], effective_models: ["vendor/model-0"] }),
      ],
      fetchModels: { models: many, source: "vendor" },
    });
    render(<CloudProvidersPage />);
    await screen.findByText("OpenAI (production)");

    fireEvent.click(screen.getByText("Edit models"));
    expect(chips()).toEqual(["vendor/model-0"]);
    fireEvent.click(screen.getByRole("button", { name: "Fetch models" }));
    await screen.findByText("12 models found");

    const already = screen.getByRole("checkbox", {
      name: "vendor/model-0 added",
    }) as HTMLInputElement;
    expect(already.checked).toBe(true);
    expect(already.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Filter fetched models"), {
      target: { value: "model-1" },
    });
    // model-1, model-10, model-11
    expect(
      screen.getByRole("list", { name: "Fetched models" }).querySelectorAll("li"),
    ).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected (3)" }));
    expect(chips()).toEqual([
      "vendor/model-0",
      "vendor/model-1",
      "vendor/model-10",
      "vendor/model-11",
    ]);
  });

  it.each([
    [
      "502 auth",
      new ApiError("authentication failed — check the API key", 502),
      "authentication failed — check the API key",
    ],
    [
      "429",
      new ApiError("Too Many Requests", 429),
      "Too many fetch requests — wait a moment and try again.",
    ],
    [
      "504",
      new ApiError("Gateway Timeout", 504),
      "The provider didn't answer in time — try again, or enter the model ids manually.",
    ],
  ])("renders a fetch-models %s error and keeps manual entry", async (_label, err, message) => {
    mockAuth = { token: "tok", role: "admin" };
    installApi({ providers: [provider()], fetchModels: err });
    render(<CloudProvidersPage />);
    await screen.findByText("OpenAI (production)");

    fireEvent.click(screen.getByRole("button", { name: "Fetch models" }));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByLabelText("Add model id")).toBeTruthy();
  });
});
