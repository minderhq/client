import { describe, expect, it } from "vitest";

import { ApiError } from "./api";
import {
  ROLE_HELP,
  changedRoles,
  dataPolicyErrorMessage,
  generationModels,
  isCloudModel,
  isLocalOnlyRefusal,
  modelDefaultsErrorMessage,
  modelOptionLabel,
  modelShortName,
  modelSourceLabel,
  pickerValue,
  remoteProviderId,
} from "./modelDefaults";

const NONE = new Set<string>();

describe("model locality", () => {
  it("parses remote ids", () => {
    expect(remoteProviderId("remote:p1:gpt-4o")).toBe("p1");
    expect(remoteProviderId("remote:p1:org/model:tag")).toBe("p1");
    expect(remoteProviderId("llama3.2:latest")).toBeNull();
    expect(modelShortName("remote:p1:org/model:tag")).toBe("org/model:tag");
    expect(modelShortName("llama3.2:latest")).toBe("llama3.2:latest");
  });

  it("treats a remote model as Cloud unless its provider is marked local", () => {
    expect(isCloudModel("llama3.2:latest", NONE)).toBe(false);
    expect(isCloudModel("remote:p1:gpt-4o", NONE)).toBe(true);
    expect(isCloudModel("remote:p1:qwen", new Set(["p1"]))).toBe(false);
    // Malformed remote id: uncertain = cloud.
    expect(isCloudModel("remote:", new Set(["p1"]))).toBe(true);
  });

  it("labels options with name, provider and a Local/Cloud badge", () => {
    expect(modelOptionLabel({ id: "llama3", name: "llama3" }, NONE)).toBe("llama3 · Local");
    expect(
      modelOptionLabel({ id: "remote:p1:gpt-4o", name: "gpt-4o", provider: "OpenAI" }, NONE),
    ).toBe("gpt-4o (OpenAI) · Cloud");
  });

  it("keeps ready generation models and stores remote ids in full", () => {
    const models = generationModels([
      { id: "llama3", name: "llama3", status: "ready" },
      { id: "nomic-embed-text", name: "nomic-embed-text", status: "ready" },
      { id: "qwen", name: "qwen", status: "loading" },
      { id: "remote:p1:gpt-4o", name: "gpt-4o", status: "ready" },
    ]);
    expect(models.map(pickerValue)).toEqual(["llama3", "remote:p1:gpt-4o"]);
  });
});

describe("role defaults", () => {
  it("sends only changed roles, an emptied one as null", () => {
    const saved = { answer: "llama3", chat: null, extraction: "qwen", utility: null };
    expect(
      changedRoles(saved, { answer: "llama3", chat: "remote:p1:gpt-4o", extraction: "", utility: "" }),
    ).toEqual({ chat: "remote:p1:gpt-4o", extraction: null });
    expect(changedRoles(saved, { answer: "llama3", chat: "", extraction: "qwen", utility: "" })).toEqual({});
  });

  it("explains the utility fallback rule", () => {
    expect(ROLE_HELP.utility).toMatch(/answer model when that is local, otherwise the local default/);
  });

  it("maps save errors per status", () => {
    expect(modelDefaultsErrorMessage(new ApiError("nope", 403))).toMatch(/org owner or admin/);
    expect(
      modelDefaultsErrorMessage(new ApiError("answer: local model 'x' is not pulled", 422)),
    ).toBe("That model can't be used: answer: local model 'x' is not pulled");
    expect(modelDefaultsErrorMessage(new ApiError("down", 503))).toMatch(/unreachable/);
    expect(modelDefaultsErrorMessage(new Error("boom"))).toBe("boom");
  });
});

describe("data policy", () => {
  it("explains a refused loosening and a failed save", () => {
    expect(dataPolicyErrorMessage(new ApiError("Forbidden", 403), true)).toMatch(
      /Only the knowledge base owner or an org admin/,
    );
    expect(dataPolicyErrorMessage(new ApiError("Forbidden", 403), false)).toBeNull();
    expect(dataPolicyErrorMessage(new ApiError("x", 503), false)).toBe("Couldn't save changes right now — nothing was changed. Try again.");
  });

  it("recognises rag-pipeline's local_only refusal", () => {
    expect(
      isLocalOnlyRefusal(
        new ApiError(
          "this knowledge base is local_only: its content may not be sent to a cloud model.",
          403,
        ),
      ),
    ).toBe(true);
    expect(isLocalOnlyRefusal(new ApiError("Forbidden", 403))).toBe(false);
  });

  it("labels model sources", () => {
    expect(modelSourceLabel("org_default")).toBe("org default");
    expect(modelSourceLabel("install_default")).toBe("install default");
    expect(modelSourceLabel("something_new")).toBe("something new");
    expect(modelSourceLabel(null)).toBeNull();
  });
});
