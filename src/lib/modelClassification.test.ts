import { describe, expect, it } from "vitest";

import { isEmbeddingModelName } from "./modelClassification";

describe("isEmbeddingModelName", () => {
  it("matches the generic 'embed' substring (existing behavior)", () => {
    expect(isEmbeddingModelName("nomic-embed-text")).toBe(true);
    expect(isEmbeddingModelName("mxbai-embed-large")).toBe(true);
    expect(isEmbeddingModelName("all-MiniLM-embed")).toBe(true);
  });

  it("matches embedding-model families that don't contain 'embed' (#1756)", () => {
    expect(isEmbeddingModelName("bge-m3")).toBe(true);
    expect(isEmbeddingModelName("BGE-M3")).toBe(true); // case-insensitive
    expect(isEmbeddingModelName("e5-large")).toBe(true);
    expect(isEmbeddingModelName("gte-base:latest")).toBe(true);
    expect(isEmbeddingModelName("instructor-xl")).toBe(true);
    expect(isEmbeddingModelName("all-minilm")).toBe(true);
    expect(isEmbeddingModelName("sentence-t5-base")).toBe(true);
  });

  it("does not match ordinary generation/LLM model names", () => {
    expect(isEmbeddingModelName("llama3")).toBe(false);
    expect(isEmbeddingModelName("mistral")).toBe(false);
    expect(isEmbeddingModelName("qwen2.5:7b")).toBe(false);
    expect(isEmbeddingModelName("phi3.5")).toBe(false);
  });

  it("requires the short family tokens to be their own delimited segment", () => {
    // "e5" appears as a bare substring here but not as its own hyphen/colon
    // delimited segment -- must not false-positive on an unrelated model.
    expect(isEmbeddingModelName("these5-model")).toBe(false);
    expect(isEmbeddingModelName("gemma3")).toBe(false);
  });
});
