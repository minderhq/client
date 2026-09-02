import { describe, expect, it } from "vitest";

import {
  type JourneyCounts,
  completedStepCount,
  kbReady,
  primaryAction,
  stepStatus,
} from "./journey";

function counts(overrides: Partial<JourneyCounts> = {}): JourneyCounts {
  return { kbCount: 0, readyKbCount: 0, pipelineCount: 0, ...overrides };
}

describe("kbReady", () => {
  it("needs both a document and vectors", () => {
    expect(kbReady({ document_count: 1, vector_count: 10 })).toBe(true);
  });

  it("is not ready with a document but zero vectors (embedding failed, #77)", () => {
    expect(kbReady({ document_count: 1, vector_count: 0 })).toBe(false);
  });

  it("is not ready when empty", () => {
    expect(kbReady({ document_count: 0, vector_count: 0 })).toBe(false);
  });
});

describe("completedStepCount", () => {
  it("is 0 before anything loads", () => {
    expect(completedStepCount(null)).toBe(0);
  });

  it("is 0 with no knowledge base", () => {
    expect(completedStepCount(counts())).toBe(0);
  });

  it("is 1 when a KB exists but is empty — Upload is next, not Pipeline (#1227)", () => {
    expect(completedStepCount(counts({ kbCount: 2, readyKbCount: 0 }))).toBe(1);
  });

  it("is 2 once a KB has documents but no pipeline exists", () => {
    expect(completedStepCount(counts({ kbCount: 1, readyKbCount: 1 }))).toBe(2);
  });

  it("is 3 once a pipeline exists too", () => {
    expect(
      completedStepCount(counts({ kbCount: 1, readyKbCount: 1, pipelineCount: 1 })),
    ).toBe(3);
  });
});

describe("stepStatus", () => {
  it("marks earlier steps done, the current one current, later ones upcoming", () => {
    // KB exists but empty -> completed=1 -> upload (index 1) is current.
    const c = counts({ kbCount: 1, readyKbCount: 0 });
    expect(stepStatus(c, 0)).toBe("done"); // kb
    expect(stepStatus(c, 1)).toBe("current"); // upload
    expect(stepStatus(c, 2)).toBe("upcoming"); // pipeline
    expect(stepStatus(c, 3)).toBe("upcoming"); // ask
  });

  it("keeps the terminal Ask step highlighted (never 'done') once ready", () => {
    const c = counts({ kbCount: 1, readyKbCount: 1, pipelineCount: 1 });
    expect(stepStatus(c, 2)).toBe("done"); // pipeline
    expect(stepStatus(c, 3)).toBe("current"); // ask stays current
  });
});

describe("primaryAction", () => {
  it("suggests creating a knowledge base when stats haven't loaded yet", () => {
    expect(primaryAction(null).to).toBe("/rag");
    expect(primaryAction(null).title).toBe("Create your first knowledge base");
  });

  it("suggests creating a knowledge base when none exist", () => {
    const action = primaryAction(counts({ kbCount: 0, pipelineCount: 5 }));
    expect(action.to).toBe("/rag");
    expect(action.title).toBe("Create your first knowledge base");
  });

  it("suggests uploading when a KB exists but has no documents (#1227)", () => {
    const action = primaryAction(counts({ kbCount: 1, readyKbCount: 0 }));
    expect(action.to).toBe("/rag");
    expect(action.title).toBe("Upload a document");
  });

  it("suggests building a pipeline once a KB is READY but no pipeline does", () => {
    const action = primaryAction(counts({ kbCount: 1, readyKbCount: 1, pipelineCount: 0 }));
    expect(action.to).toBe("/rag/pipelines");
    expect(action.title).toBe("Build a pipeline");
    expect(action.body).toContain("1 knowledge base ready"); // singular
  });

  it("pluralizes the ready-KB count in the pipeline suggestion", () => {
    const action = primaryAction(counts({ kbCount: 3, readyKbCount: 3, pipelineCount: 0 }));
    expect(action.body).toContain("3 knowledge bases ready");
  });

  it("suggests asking a question once a ready KB and a pipeline exist", () => {
    const action = primaryAction(counts({ kbCount: 2, readyKbCount: 2, pipelineCount: 1 }));
    expect(action.to).toBe("/ask");
    expect(action.title).toBe("Ask a question");
    expect(action.body).toContain("1 pipeline "); // singular
  });

  it("pluralizes the pipeline count in the ask-a-question suggestion", () => {
    const action = primaryAction(counts({ kbCount: 2, readyKbCount: 2, pipelineCount: 4 }));
    expect(action.body).toContain("4 pipelines ");
  });
});
