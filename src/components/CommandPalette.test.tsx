import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandPalette } from "./CommandPalette";

let mockAuth = { role: "", sessionKey: "" };
vi.mock("../lib/auth", () => ({ useAuth: () => mockAuth }));

let mockBilling = true;
vi.mock("../lib/useBillingAccess", () => ({ useBillingAccess: () => mockBilling }));

// One stable ref, like the real hook (a fresh object per render would re-run
// the palette's search effect forever).
const tokenRef = { current: "" };
vi.mock("../lib/useTokenRef", () => ({ useTokenRef: () => tokenRef }));

// Live resource search is out of scope here; keep it from hitting the network.
vi.mock("../lib/api", () => ({ apiFetch: vi.fn().mockResolvedValue({ items: [], plugins: [] }) }));

// jsdom has no layout, so no scrollIntoView (the palette keeps the active row
// in view with it).
Element.prototype.scrollIntoView = () => {};

let pathname = "";
function Probe() {
  pathname = useLocation().pathname;
  return null;
}

function open() {
  render(
    <MemoryRouter>
      <CommandPalette open onClose={() => {}} />
      <Probe />
    </MemoryRouter>,
  );
}

function search(q: string) {
  fireEvent.change(screen.getByRole("combobox"), { target: { value: q } });
}

function resultLabels(): string[] {
  return screen
    .getAllByRole("option")
    .map((o) => o.querySelector("span.block.truncate")?.textContent ?? "");
}

describe("CommandPalette — marketplace entries (#2197)", () => {
  beforeEach(() => {
    mockAuth = { role: "", sessionKey: "" };
    mockBilling = true;
  });
  afterEach(cleanup);

  it("lists the marketplace pages by their page titles", () => {
    open();
    search("plugins");
    expect(resultLabels()).toEqual(
      expect.arrayContaining(["Discover plugins", "Installed plugins", "Plugin submissions"]),
    );
    expect(resultLabels()).not.toContain("Plugins: Browse");
  });

  it("finds AI tools and service bundles under both Discover and Installed", () => {
    open();
    search("ai tools");
    expect(resultLabels()).toEqual(expect.arrayContaining(["Discover AI tools", "Installed AI tools"]));
    search("bundles");
    expect(resultLabels()).toEqual(
      expect.arrayContaining(["Discover service bundles", "Installed service bundles"]),
    );
  });

  it("navigates to the new route", () => {
    open();
    search("discover plugins");
    fireEvent.click(screen.getByText("Discover plugins"));
    expect(pathname).toBe("/marketplace/discover/plugins");
  });

  it("offers MindHub & sources and Submission review to admins only", () => {
    open();
    search("mindhub");
    expect(screen.queryByText("MindHub & sources")).toBeNull();
    search("review queue");
    expect(screen.queryByText("Submission review")).toBeNull();
    cleanup();

    mockAuth = { role: "admin", sessionKey: "" };
    open();
    search("mindhub");
    expect(screen.getByText("MindHub & sources")).toBeTruthy();
    search("review queue");
    expect(screen.getByText("Submission review")).toBeTruthy();
  });

  it("hides Billing without billing access but keeps Plugin licenses", () => {
    mockBilling = false;
    open();
    search("billing");
    expect(resultLabels()).not.toContain("Billing");
    expect(resultLabels()).toContain("Plugin licenses");
  });
});
