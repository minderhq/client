import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Bundle } from "../lib/bundles";
import { AvailableBundlesPage } from "./AvailableBundlesPage";

const apiFetch = vi.fn();

vi.mock("../lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  friendlyErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
}));
let mockAuth = { token: "tok", role: "admin" };
vi.mock("../lib/auth", () => ({
  useAuth: () => mockAuth,
}));

function bundle(overrides: Partial<Bundle> = {}): Bundle {
  return {
    name: "monitoring",
    core: false,
    enabled: false,
    claims: [],
    services: [],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  apiFetch.mockReset();
  mockAuth = { token: "tok", role: "admin" };
});

describe("AvailableBundlesPage", () => {
  it("shows only the not-yet-enabled bundles", async () => {
    apiFetch.mockResolvedValue({
      bundles: [
        bundle({ name: "monitoring", enabled: false }),
        bundle({ name: "core", enabled: true }),
        bundle({ name: "voice", enabled: false }),
      ],
      count: 3,
    });
    render(<AvailableBundlesPage />, { wrapper: MemoryRouter });

    expect(await screen.findByText("monitoring")).toBeTruthy();
    expect(screen.getByText("voice")).toBeTruthy();
    expect(screen.queryByText("core")).toBeNull();
  });

  it("shows an empty state when every bundle is already enabled", async () => {
    apiFetch.mockResolvedValue({
      bundles: [bundle({ name: "core", enabled: true })],
      count: 1,
    });
    render(<AvailableBundlesPage />, { wrapper: MemoryRouter });

    expect(await screen.findByText(/Every service bundle is already enabled/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Installed service bundles" }).getAttribute("href"),
    ).toBe("/marketplace/installed/service-bundles");
  });
  it("shows a skeleton, not the empty state, while loading; an error offers Retry (#2195)", async () => {
    let reject!: (e: unknown) => void;
    apiFetch.mockReturnValueOnce(new Promise((_, r) => (reject = r)));
    render(<AvailableBundlesPage />, { wrapper: MemoryRouter });

    expect(screen.getByTestId("card-list-skeleton")).toBeTruthy();
    expect(screen.queryByText(/Every service bundle is already enabled/)).toBeNull();

    reject(new Error("bundle reconciler down"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't load the service bundles.");
    expect(alert.textContent).toContain("bundle reconciler down");
    expect(screen.queryByText(/Every service bundle is already enabled/)).toBeNull();

    apiFetch.mockResolvedValueOnce({ bundles: [bundle({ name: "voice" })], count: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Retry loading service bundles" }));
    expect(await screen.findByRole("heading", { level: 3, name: "voice" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enable voice" })).toBeTruthy();
  });

  it("tells a non-admin once, for the whole list, and every card's button points at that note", async () => {
    mockAuth = { token: "tok", role: "member" };
    apiFetch.mockResolvedValue({
      bundles: [bundle({ name: "voice" }), bundle({ name: "monitoring" }), bundle({ name: "rag" })],
      count: 3,
    });
    render(<AvailableBundlesPage />, { wrapper: MemoryRouter });

    await screen.findByRole("heading", { level: 3, name: "rag" });
    const notes = screen.getAllByText("Only an admin can enable or disable bundles.");
    expect(notes).toHaveLength(1);
    for (const name of ["voice", "monitoring", "rag"]) {
      const button = screen.getByRole("button", { name: `Enable ${name}` });
      expect(button.hasAttribute("disabled")).toBe(true);
      expect(button.getAttribute("aria-describedby")).toBe(notes[0].id);
    }
  });

  it("shows no admin note to an admin", async () => {
    apiFetch.mockResolvedValue({ bundles: [bundle({ name: "voice" })], count: 1 });
    render(<AvailableBundlesPage />, { wrapper: MemoryRouter });

    const button = await screen.findByRole("button", { name: "Enable voice" });
    expect(button.getAttribute("aria-describedby")).toBeNull();
    expect(screen.queryByText(/Only an admin can/)).toBeNull();
  });
});
