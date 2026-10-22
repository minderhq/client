import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import { ModelDefaultsPanel } from "./ModelDefaultsPanel";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const DEFAULTS = {
  answer: "llama3",
  chat: null,
  extraction: null,
  utility: null,
  updated_at: null,
  updated_by: null,
};

const MODELS = [
  { id: "llama3", name: "llama3", status: "ready" },
  { id: "qwen3", name: "qwen3", status: "ready" },
  { id: "nomic-embed-text", name: "nomic-embed-text", status: "ready" },
  { id: "remote:p1:gpt-4o", name: "gpt-4o", provider: "OpenAI", status: "ready" },
  { id: "remote:p2:local-vllm", name: "local-vllm", provider: "Box", status: "ready" },
];

function installApi(putResult: () => Promise<unknown> = () => Promise.resolve(DEFAULTS)) {
  apiFetch.mockImplementation((path: string, opts: { method?: string } = {}) => {
    if (path === "/v1/model-defaults" && opts.method === "PUT") return putResult();
    if (path === "/v1/model-defaults") return Promise.resolve(DEFAULTS);
    if (path.startsWith("/v1/models")) return Promise.resolve({ items: MODELS });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

function select(role: string) {
  return screen.getByLabelText(role) as HTMLSelectElement;
}

describe("ModelDefaultsPanel", () => {
  afterEach(() => {
    cleanup();
    apiFetch.mockReset();
  });

  it("shows the saved defaults with a picker and helper text per role", async () => {
    installApi();
    render(<ModelDefaultsPanel token="tok" canEdit localProviders={new Set(["p2"])} />);

    await waitFor(() => expect(select("Answer").value).toBe("llama3"));
    expect(select("Chat").value).toBe("");
    expect(screen.getByText("Writes knowledge-base answers.")).toBeTruthy();
    expect(screen.getByText(/Chat and tools/)).toBeTruthy();
    expect(screen.getByText(/Graph building/)).toBeTruthy();
    expect(
      screen.getByText(/uses the answer model when that is local, otherwise the local default, unless you pick one/i),
    ).toBeTruthy();

    const labels = Array.from(select("Chat").options).map((o) => o.textContent);
    expect(labels).toEqual([
      "None (use install default)",
      "llama3 · Local",
      "qwen3 · Local",
      "gpt-4o (OpenAI) · Cloud",
      // A provider row marked is_local serves Local models.
      "local-vllm (Box) · Local",
    ]);
    // Defaults read the caller's own catalog, with the token (remote models
    // are only listed for a signed-in caller).
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/models?limit=500",
      expect.objectContaining({ token: "tok" }),
    );
  });

  it("is read-only for a member", async () => {
    installApi();
    render(<ModelDefaultsPanel token="tok" canEdit={false} />);
    await waitFor(() => expect(select("Answer").value).toBe("llama3"));
    expect(screen.getByText("Only an org owner or admin can change the default models.")).toBeTruthy();
    expect(select("Answer").closest("fieldset")?.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Save defaults" })).toBeNull();
  });

  it("saves only the changed roles; None clears a role", async () => {
    installApi();
    render(<ModelDefaultsPanel token="tok" canEdit />);
    await waitFor(() => expect(select("Answer").value).toBe("llama3"));
    expect((screen.getByRole("button", { name: "Save defaults" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(select("Answer"), { target: { value: "" } });
    fireEvent.change(select("Chat"), { target: { value: "remote:p1:gpt-4o" } });
    fireEvent.click(screen.getByRole("button", { name: "Save defaults" }));

    await screen.findByText("Saved.");
    expect(apiFetch).toHaveBeenCalledWith("/v1/model-defaults", {
      method: "PUT",
      token: "tok",
      body: { answer: null, chat: "remote:p1:gpt-4o" },
    });
  });

  it.each([
    [new ApiError("chat: provider is disabled", 422), "That model can't be used: chat: provider is disabled"],
    [new ApiError("Insufficient permissions", 403), "Only an org owner or admin can change the default models."],
    [
      new ApiError("Ollama is unreachable; cannot validate local model ids", 503),
      "The local model server is unreachable, so the local models can't be checked. Try again shortly.",
    ],
  ])("explains a failed save (%s)", async (error, message) => {
    installApi(() => Promise.reject(error));
    render(<ModelDefaultsPanel token="tok" canEdit />);
    await waitFor(() => expect(select("Answer").value).toBe("llama3"));
    fireEvent.change(select("Chat"), { target: { value: "qwen3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save defaults" }));
    expect(await screen.findByText(message)).toBeTruthy();
    // The draft is kept so the admin can fix it and retry.
    expect(select("Chat").value).toBe("qwen3");
  });

  it("keeps a saved default the catalog no longer lists", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === "/v1/model-defaults") {
        return Promise.resolve({ ...DEFAULTS, answer: "remote:gone:old-model" });
      }
      return Promise.resolve({ items: MODELS });
    });
    render(<ModelDefaultsPanel token="tok" canEdit />);
    await waitFor(() => expect(select("Answer").value).toBe("remote:gone:old-model"));
    expect(screen.getByRole("option", { name: /remote:gone:old-model · Cloud \(not available\)/ })).toBeTruthy();
  });
});

describe("ModelDefaultsPanel GPU fit", () => {
  const GIB = 1024 ** 3;
  const FIT_MODELS = [
    { id: "llama3", name: "llama3", status: "ready" },
    { id: "small", name: "small", status: "ready", estimated_bytes: 11.1 * GIB, fit: "fits" },
    { id: "big", name: "big", status: "ready", estimated_bytes: 19 * GIB, fit: "too_large" },
    { id: "odd", name: "odd", status: "ready", estimated_bytes: 5 * GIB, fit: "unknown" },
  ];

  afterEach(() => {
    cleanup();
    apiFetch.mockReset();
  });

  function installFitApi() {
    apiFetch.mockImplementation((path: string, opts: { method?: string } = {}) => {
      if (path === "/v1/model-defaults" && opts.method === "PUT") return Promise.resolve(DEFAULTS);
      if (path === "/v1/model-defaults") return Promise.resolve(DEFAULTS);
      return Promise.resolve({ items: FIT_MODELS });
    });
  }

  function puts() {
    return apiFetch.mock.calls.filter(([, o]) => (o as { method?: string })?.method === "PUT");
  }

  it("labels each option with its size and fit, and nothing for an unknown fit", async () => {
    installFitApi();
    render(<ModelDefaultsPanel token="tok" canEdit />);
    await waitFor(() => expect(select("Answer").value).toBe("llama3"));
    expect(Array.from(select("Chat").options).map((o) => o.textContent)).toEqual([
      "None (use install default)",
      "llama3 · Local",
      "small · Local · 11.1 GB · Fits the GPU",
      "big · Local · 19 GB · Too large",
      "odd · Local",
    ]);
    fireEvent.change(select("Chat"), { target: { value: "big" } });
    expect(screen.getByText("19 GB · Too large")).toBeTruthy();
  });

  it("saves a model that fits without asking", async () => {
    installFitApi();
    render(<ModelDefaultsPanel token="tok" canEdit />);
    await waitFor(() => expect(select("Answer").value).toBe("llama3"));
    fireEvent.change(select("Chat"), { target: { value: "small" } });
    fireEvent.click(screen.getByRole("button", { name: "Save defaults" }));
    await screen.findByText("Saved.");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(puts()).toHaveLength(1);
  });

  it("asks before saving a model that is too large, naming the RAM impact", async () => {
    installFitApi();
    render(<ModelDefaultsPanel token="tok" canEdit />);
    await waitFor(() => expect(select("Answer").value).toBe("llama3"));
    fireEvent.change(select("Chat"), { target: { value: "big" } });
    fireEvent.click(screen.getByRole("button", { name: "Save defaults" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/big, ~19 GB/);
    expect(dialog.textContent).toMatch(/system RAM/);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(puts()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Save defaults" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use it anyway" }));
    await screen.findByText("Saved.");
    expect(puts()).toHaveLength(1);
  });
});
