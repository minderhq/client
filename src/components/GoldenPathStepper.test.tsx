import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { JourneyCounts } from "../lib/journey";
import type { Readiness } from "../lib/readiness";
import type { AsyncResource } from "../lib/useAsyncResource";

const useAuthMock = vi.fn();
const useJourneyMock = vi.fn();
let canManageAi = false;
let readiness: Readiness | null = null;

vi.mock("../lib/auth", () => ({ useAuth: () => useAuthMock() }));
vi.mock("../lib/useJourney", () => ({ useJourney: () => useJourneyMock() }));
vi.mock("../lib/useCan", () => ({ useCan: () => canManageAi }));
vi.mock("../lib/readiness", () => ({
  useReadiness: () => ({ data: readiness, error: null, loading: false, reload: () => {} }),
}));

function readinessWith(modelReady: boolean): Readiness {
  const ok = { ready: true, reason: null };
  return {
    ready: modelReady,
    checks: {
      model: modelReady ? ok : { ready: false, reason: "no_model" },
      pipeline: ok,
      knowledge_base: ok,
      email: ok,
    },
  };
}

// Imported after the mocks are registered.
import { GoldenPathStepper } from "./GoldenPathStepper";

function resource(data: JourneyCounts | null): AsyncResource<JourneyCounts> {
  return { data, error: null, loading: false, reload: () => {} };
}

function renderStepper() {
  return render(
    <MemoryRouter>
      <GoldenPathStepper />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  useAuthMock.mockReset();
  useJourneyMock.mockReset();
  canManageAi = false;
  readiness = null;
});

describe("GoldenPathStepper", () => {
  it("renders nothing while logged out (the path is about creating things)", () => {
    useAuthMock.mockReturnValue({ token: "" });
    useJourneyMock.mockReturnValue(resource(null));
    const { container } = renderStepper();
    expect(container.firstChild).toBeNull();
  });

  it("shows all four steps and marks the first as current for a fresh install", () => {
    useAuthMock.mockReturnValue({ token: "tok" });
    useJourneyMock.mockReturnValue(
      resource({ kbCount: 0, readyKbCount: 0, pipelineCount: 0 }),
    );
    renderStepper();

    expect(screen.getByText("Knowledge base")).toBeTruthy();
    expect(screen.getByText("Upload docs")).toBeTruthy();
    expect(screen.getByText("Pipeline")).toBeTruthy();
    expect(screen.getByText("Ask")).toBeTruthy();

    // The current step carries aria-current + the "Next:" hint mirrors it.
    const current = screen.getByRole("link", { current: "step" });
    expect(current.getAttribute("href")).toBe("/rag");
    expect(screen.getByText("Create your first knowledge base")).toBeTruthy();
  });

  it("advances the current step to Ask once a ready KB and pipeline exist", () => {
    useAuthMock.mockReturnValue({ token: "tok" });
    useJourneyMock.mockReturnValue(
      resource({ kbCount: 2, readyKbCount: 2, pipelineCount: 1 }),
    );
    renderStepper();

    const current = screen.getByRole("link", { current: "step" });
    expect(current.getAttribute("href")).toBe("/ask");
    expect(screen.getByText("Ask a question")).toBeTruthy();
  });

  it("puts a current Model step first for an admin while no model is connected", () => {
    useAuthMock.mockReturnValue({ token: "tok" });
    useJourneyMock.mockReturnValue(resource({ kbCount: 2, readyKbCount: 2, pipelineCount: 1 }));
    canManageAi = true;
    readiness = readinessWith(false);
    renderStepper();

    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    const current = screen.getByRole("link", { current: "step" });
    expect(current.getAttribute("href")).toBe("/platform/providers");
    expect(current.textContent).toBe("Model");
    expect(screen.getByText("Connect a model")).toBeTruthy();
  });

  it("marks the admin's Model step done once a model is connected", () => {
    useAuthMock.mockReturnValue({ token: "tok" });
    useJourneyMock.mockReturnValue(resource({ kbCount: 0, readyKbCount: 0, pipelineCount: 0 }));
    canManageAi = true;
    readiness = readinessWith(true);
    renderStepper();

    expect(screen.getByText("Model")).toBeTruthy();
    const current = screen.getByRole("link", { current: "step" });
    expect(current.textContent).toBe("Knowledge base");
    expect(screen.getByText("Create your first knowledge base")).toBeTruthy();
  });

  it("shows the four steps unchanged to a member, even with no model", () => {
    useAuthMock.mockReturnValue({ token: "tok" });
    useJourneyMock.mockReturnValue(resource({ kbCount: 0, readyKbCount: 0, pipelineCount: 0 }));
    readiness = readinessWith(false);
    renderStepper();

    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.queryByText("Model")).toBeNull();
    expect(screen.getByText("Create your first knowledge base")).toBeTruthy();
  });

  it("adds no Model step for an admin until the check has been read", () => {
    useAuthMock.mockReturnValue({ token: "tok" });
    useJourneyMock.mockReturnValue(resource(null));
    canManageAi = true;
    renderStepper();

    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });
});
