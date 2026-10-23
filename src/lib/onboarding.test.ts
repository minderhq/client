import { afterEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("./api", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import { markOnboardingStep, orderSteps } from "./onboarding";

const ids = (steps: { id: string }[]) => steps.map((s) => s.id);
const STEPS = ["model", "knowledge_base", "upload", "assistant", "ask", "invite"].map((id) => ({ id }));

describe("orderSteps (owner decision O1)", () => {
  it("keeps the default order while the intro is unanswered", () => {
    expect(ids(orderSteps(STEPS, null, null))).toEqual(ids(STEPS));
  });

  it("moves the intended use's steps up, after the model step", () => {
    expect(ids(orderSteps(STEPS, "docs_qa", null))).toEqual([
      "model",
      "upload",
      "ask",
      "knowledge_base",
      "assistant",
      "invite",
    ]);
  });

  it("puts invite last for a solo user and up for a team", () => {
    expect(ids(orderSteps(STEPS, null, "solo")).at(-1)).toBe("invite");
    expect(ids(orderSteps(STEPS, null, "team"))[1]).toBe("invite");
  });

  it("ignores boosts for steps the caller doesn't have", () => {
    const member = ["ask", "use_kb", "profile"].map((id) => ({ id }));
    expect(ids(orderSteps(member, "team_knowledge", "team"))).toEqual(["ask", "use_kb", "profile"]);
  });
});

describe("markOnboardingStep", () => {
  afterEach(() => apiFetch.mockReset());

  it("stores the step once per session", async () => {
    apiFetch.mockResolvedValue({});
    markOnboardingStep("tok", "session-a", "ask");
    markOnboardingStep("tok", "session-a", "ask");
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith("/v1/onboarding", {
      method: "PATCH",
      body: { checklist: { ask: "done" } },
      token: "tok",
    });
  });

  it("tries again after a failure, and never while signed out", async () => {
    apiFetch.mockRejectedValueOnce(new Error("down")).mockResolvedValue({});
    markOnboardingStep("tok", "session-b", "ask");
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    markOnboardingStep("tok", "session-b", "ask");
    expect(apiFetch).toHaveBeenCalledTimes(2);
    markOnboardingStep("", "", "ask");
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
});
