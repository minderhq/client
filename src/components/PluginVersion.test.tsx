import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ListedVersion, PluginVersion } from "./PluginVersion";

afterEach(cleanup);

describe("PluginVersion (Installed cards)", () => {
  it("shows the installed version with no hint when it matches the listing", () => {
    const { container } = render(<PluginVersion installed="1.2.0" listed="1.2.0" />);
    expect(container.textContent).toBe("Installed version v1.2.0");
  });

  it("adds a quiet hint when the catalog lists a newer version", () => {
    render(<PluginVersion installed="1.2.0" listed="1.3.0" />);
    expect(screen.getByText("Newer version listed: v1.3.0")).toBeTruthy();
  });

  it("uses neutral wording when the versions differ but can't be ordered", () => {
    render(<PluginVersion installed="nightly" listed="1.3.0" />);
    expect(screen.getByText("Listed version: v1.3.0")).toBeTruthy();
    expect(screen.queryByText(/Newer/)).toBeNull();
  });

  it("renders nothing when the installed version is unknown", () => {
    const { container } = render(<PluginVersion installed={null} listed="1.3.0" />);
    expect(container.innerHTML).toBe("");
  });
});

describe("ListedVersion (Browse cards)", () => {
  it("shows the listed version alone when nothing is installed", () => {
    const { container } = render(<ListedVersion listed="1.3.0" installed={undefined} />);
    expect(container.textContent).toBe("Listed version v1.3.0");
  });

  it("hints when the caller's installed version is older", () => {
    render(<ListedVersion listed="1.3.0" installed="1.2.0" />);
    expect(screen.getByText("You have v1.2.0 · newer version listed")).toBeTruthy();
  });

  it("says nothing extra when the installed version matches", () => {
    const { container } = render(<ListedVersion listed="1.3.0" installed="1.3.0" />);
    expect(container.textContent).toBe("Listed version v1.3.0");
  });

  it("renders nothing when the catalog lists no version", () => {
    const { container } = render(<ListedVersion listed={null} installed="1.0.0" />);
    expect(container.innerHTML).toBe("");
  });
});
