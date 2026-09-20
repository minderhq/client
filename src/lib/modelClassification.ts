/**
 * Shared embedding-vs-generation model classification (#1756).
 *
 * The backend's `/v1/models` list (Ollama's `/api/tags` under the hood) does not
 * carry a capability signal -- Ollama only exposes `capabilities` (e.g.
 * `["completion", "embedding", ...]`) via the per-model `/api/show` call, which
 * would mean one extra Ollama round-trip per listed model just to populate a
 * dropdown (see `core/ollama_manager.py`'s `list_models()` vs. `show_model()`
 * in minderhq/minder). Not worth the added latency/load for this UI, so
 * classification stays name-based on the client -- but widened beyond a bare
 * "embed" substring, which missed real, popular embedding-only families (BGE,
 * E5, GTE, Instructor, Arctic-Embed, MiniLM, sentence-T5, Nomic-Embed,
 * Mxbai-Embed) that don't literally contain "embed" in their Ollama tag.
 *
 * Single predicate so the embedding/generation dropdowns built from it stay
 * mutually exclusive and exhaustive -- do not duplicate this regex elsewhere.
 */
// "embed" as a generic substring already covers nomic-embed-text,
// mxbai-embed-large, arctic-embed-m, etc. -- anything whose tag literally
// says "embed". The remaining families (bge, e5, gte, instructor, minilm,
// sentence-t5) don't, so they're listed explicitly. Those are wrapped in
// `\b...\b` (word boundaries) rather than bare substrings: short tokens like
// "e5"/"gte"/"bge" could otherwise false-positive inside an unrelated
// generation model's name; a word boundary requires them to be their own
// hyphen/colon/underscore-delimited segment, matching how Ollama tags are
// actually structured (e.g. "bge-m3", "e5-large", "gte-base:latest").
const EMBEDDING_MODEL_NAME_PATTERN =
  /embed|\b(?:bge|e5|gte|instructor|minilm|sentence-t5)\b/i;

export function isEmbeddingModelName(name: string): boolean {
  return EMBEDDING_MODEL_NAME_PATTERN.test(name);
}
