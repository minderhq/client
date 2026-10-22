import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Readiness, ReadinessCheck } from "../lib/readiness";

let canManageAi = false;
let readiness: Readiness | null = null;

vi.mock("../lib/useCan", () => ({ useCan: () => canManageAi }));
vi.mock("../lib/readiness", async () => {
  const actual = await vi.importActual<typeof import("../lib/readiness")>("../lib/readiness");
  return {
    ...actual,
    useReadiness: () => ({ data: readiness, error: null, loading: false, reload: () => {} }),
  };
});

// Imported after the mocks are registered.
import { ConnectModelCard } from "./ConnectModelCard";

function withModel(model: ReadinessCheck): Readiness {
  const ok = { ready: true, reason: null };
  return {
    ready: model.ready,
    checks: { model, pipeline: ok, knowledge_base: ok, email: ok },
  };
}

function renderCard() {
  return render(
    <MemoryRouter>
      <ConnectModelCard />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  canManageAi = false;
  readiness = null;
});

describe("ConnectModelCard", () => {
  it("renders nothing when the model check passes", () => {
    canManageAi = true;
    readiness = withModel({ ready: true, reason: null });
    const { container } = renderCard();
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing until readiness has been read", () => {
    canManageAi = true;
    const { container } = renderCard();
    expect(container.firstChild).toBeNull();
  });

  it("gives an admin the providers page and the docs when no model exists", () => {
    canManageAi = true;
    readiness = withModel({ ready: false, reason: "no_model" });
    renderCard();

    expect(screen.getByRole("heading", { name: "Connect a model" })).toBeTruthy();
    expect(screen.getByText(/No language model is available yet/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Open Providers & defaults/ }).getAttribute("href"),
    ).toBe("/platform/providers");
    expect(
      screen.getByRole("link", { name: /How to connect your models/ }).getAttribute("href"),
    ).toBe("https://minderhq.github.io/docs/model-providers/");
  });

  it("tells an admin when the model service isn't answering", () => {
    canManageAi = true;
    readiness = withModel({ ready: false, reason: "model_service_unavailable" });
    renderCard();
    expect(screen.getByText(/The model service isn't answering/)).toBeTruthy();
  });

  it("asks a member to contact an administrator, with no links", () => {
    readiness = withModel({ ready: false, reason: "no_model" });
    renderCard();

    expect(screen.getByText(/Ask an administrator to connect a model/)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
