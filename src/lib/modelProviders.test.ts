import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./api";
import {
  fetchModelsErrorMessage,
  fetchProviderModels,
  isLoopbackUrl,
  MAX_MODELS,
  mergeModelIds,
  modelIdError,
  updateProvider,
} from "./modelProviders";

const apiFetch = vi.fn();
vi.mock("./api", async (importOriginal) => ({
  ApiError: (await importOriginal<typeof import("./api")>()).ApiError,
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

describe("modelProviders", () => {
  afterEach(() => apiFetch.mockReset());

  it("POSTs fetch-models with no body and an encoded id", async () => {
    apiFetch.mockResolvedValue({ models: ["a"], source: "vendor" });
    await expect(fetchProviderModels("tok", "a/b")).resolves.toEqual({
      models: ["a"],
      source: "vendor",
    });
    expect(apiFetch).toHaveBeenCalledWith("/v1/model-providers/a%2Fb/fetch-models", {
      method: "POST",
      token: "tok",
    });
  });

  it("PATCHes models (an empty list clears them)", async () => {
    apiFetch.mockResolvedValue({});
    await updateProvider("tok", "p1", { models: [] });
    expect(apiFetch).toHaveBeenCalledWith("/v1/model-providers/p1", {
      method: "PATCH",
      token: "tok",
      body: { models: [] },
    });
  });

  it.each([
    ["", "Enter a model id."],
    ["   ", "Enter a model id."],
    ["a b", "spaces"],
    ["a\tb", "spaces"],
    ["a\u0007b", "control"],
    ["x".repeat(201), "200 characters"],
    ["dup", "already in the list"],
  ])("rejects %j", (id, message) => {
    expect(modelIdError(id, ["dup"])).toContain(message);
  });

  it("accepts vendor-style ids, trimmed", () => {
    for (const id of ["glm-4.6", " openai/gpt-4o ", "x".repeat(200), "a:b@c"]) {
      expect(modelIdError(id, [])).toBeNull();
    }
  });

  it("caps the list at MAX_MODELS", () => {
    const full = Array.from({ length: MAX_MODELS }, (_, i) => `m${i}`);
    expect(modelIdError("extra", full)).toContain(`at most ${MAX_MODELS}`);
    expect(mergeModelIds(full.slice(0, MAX_MODELS - 1), ["a", "b"])).toHaveLength(
      MAX_MODELS,
    );
  });

  it("merges in order, skipping duplicates and invalid ids", () => {
    expect(mergeModelIds(["a"], ["b", "a", "c d", " e ", "b"])).toEqual([
      "a",
      "b",
      "e",
    ]);
  });

  it.each([
    [403, "permission to manage model providers to fetch models"],
    [404, "no longer exists"],
    [429, "Too many fetch requests"],
    [504, "didn't answer in time"],
    [500, "rotate the key"],
  ])("maps a %i to a readable message", (status, message) => {
    expect(fetchModelsErrorMessage(new ApiError("raw", status))).toContain(message);
  });

  it("shows a 502's backend detail verbatim", () => {
    const detail =
      "the provider doesn't list its models -- enter the model ids manually";
    expect(fetchModelsErrorMessage(new ApiError(detail, 502))).toBe(detail);
  });
});

describe("isLoopbackUrl", () => {
  it.each([
    "http://localhost:1234/v1",
    "localhost:8080",
    "http://127.0.0.1:8000/v1",
    "http://127.1.2.3",
    "http://[::1]:8080/v1",
    "http://0.0.0.0:11434",
  ])("flags %s", (url) => expect(isLoopbackUrl(url)).toBe(true));

  it.each(["", "http://192.168.1.50:1234/v1", "http://host.docker.internal:1234", "https://api.example.com/v1", "not a url"])(
    "does not flag %s",
    (url) => expect(isLoopbackUrl(url)).toBe(false),
  );
});
