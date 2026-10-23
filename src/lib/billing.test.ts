import { describe, expect, it } from "vitest";

import { parseDeploymentMode, tierLabel, upgradeTierFor } from "./billing";

describe("plan helpers", () => {
  it("defaults to self-hosted (no buy buttons) for anything but saas / air-gapped", () => {
    expect(parseDeploymentMode("saas")).toBe("saas");
    expect(parseDeploymentMode(" Air-Gapped ")).toBe("air-gapped");
    expect(parseDeploymentMode(undefined)).toBe("self-hosted");
    expect(parseDeploymentMode("cloud")).toBe("self-hosted");
  });

  it("names the plan that lifts a limit, and none past Enterprise", () => {
    expect(upgradeTierFor("free")).toBe("pro");
    expect(upgradeTierFor("community")).toBe("pro");
    expect(upgradeTierFor("professional")).toBe("enterprise");
    expect(upgradeTierFor("enterprise")).toBeNull();
    expect(tierLabel("community")).toBe("Community");
    expect(tierLabel("custom")).toBe("custom");
  });
});
