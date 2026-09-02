import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { JourneyCounts } from "../lib/journey";
import type { AsyncResource } from "../lib/useAsyncResource";

const useAuthMock = vi.fn();
const useJourneyMock = vi.fn();

vi.mock("../lib/auth", () => ({ useAuth: () => useAuthMock() }));
vi.mock("../lib/useJourney", () => ({ useJourney: () => useJourneyMock() }));

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
  useAuthMock.mockReset();
  useJourneyMock.mockReset();
  cleanup();
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
});
