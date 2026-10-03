import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { type Bundle } from "../lib/bundles";
import { BundleCard } from "./BundleCard";

function makeBundle(overrides: Partial<Bundle> = {}): Bundle {
  return {
    name: "core",
    core: true,
    enabled: true,
    claims: [],
    services: [
      { name: "postgres", active: true, claimants: ["core"], image: "postgres:16" },
      { name: "redis", active: false, claimants: ["core"], image: "redis:7" },
    ],
    ...overrides,
  };
}

/** The active/inactive dot next to each service is color-only and
 * aria-hidden -- without a text alternative a screen-reader user has no way
 * to tell which services in a bundle are actually running. */
describe("BundleCard service status text alternative", () => {
  afterEach(cleanup);

  it("exposes an 'Active'/'Inactive' text alternative for each service's status dot", () => {
    render(
      <BundleCard
        bundle={makeBundle()}
        token="tok"
        isAdmin={false}
        onChanged={() => {}}
      />,
    );
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Inactive")).toBeTruthy();
  });
});

describe("BundleCard accessibility (#2195)", () => {
  afterEach(cleanup);

  function reasonFor(button: HTMLElement) {
    const id = button.getAttribute("aria-describedby");
    return id ? document.getElementById(id)?.textContent : null;
  }

  it("names the action after the bundle and shows a text + icon status badge", () => {
    render(
      <BundleCard
        bundle={makeBundle({ name: "rag", core: false, enabled: true })}
        token="tok"
        isAdmin
        onChanged={() => {}}
      />,
    );

    expect(screen.getByRole("heading", { level: 3, name: "rag" })).toBeTruthy();
    const button = screen.getByRole("button", { name: "Disable rag" });
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(button.getAttribute("aria-describedby")).toBeNull();
    const badge = screen.getByText("Enabled");
    expect(badge.getAttribute("data-status-badge")).toBe("Enabled");
    expect(badge.querySelector("svg")).toBeTruthy();
  });

  it("shows a non-admin why Enable is disabled, as visible text tied to the button", () => {
    render(
      <BundleCard
        bundle={makeBundle({ name: "voice", core: false, enabled: false })}
        token="tok"
        isAdmin={false}
        onChanged={() => {}}
      />,
    );

    const button = screen.getByRole("button", { name: "Enable voice" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("title")).toBeNull();
    expect(screen.getByText("Only an admin can enable bundles.")).toBeTruthy();
    expect(reasonFor(button)).toBe("Only an admin can enable bundles.");
  });

  it("tells a logged-out visitor to log in as an admin", () => {
    render(
      <BundleCard
        bundle={makeBundle({ name: "rag", core: false, enabled: true })}
        token=""
        isAdmin={false}
        onChanged={() => {}}
      />,
    );

    expect(reasonFor(screen.getByRole("button", { name: "Disable rag" }))).toBe(
      "Log in as an admin to disable bundles.",
    );
  });

  it("explains the always-on core bundle in visible text, without an emoji", () => {
    const { container } = render(
      <BundleCard bundle={makeBundle()} token="tok" isAdmin onChanged={() => {}} />,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Always on")).toBeTruthy();
    expect(screen.getByText("Core is the always-on kernel, so it can't be disabled.")).toBeTruthy();
    expect(container.querySelector("[title]")).toBeNull();
    expect(container.textContent).not.toContain("🔒");
  });
});
