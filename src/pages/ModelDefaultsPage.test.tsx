import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelDefaultsPage } from "./ModelDefaultsPage";

const apiFetch = vi.fn();
vi.mock("../lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  friendlyErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
}));
vi.mock("../lib/auth", () => ({
  useAuth: () => ({ token: "tok", sessionKey: "s1" }),
}));
// The panel's own loading, error and save states are tested in
// ModelDefaultsPanel.test.tsx; here only what the tab hands it.
vi.mock("../components/ModelDefaultsPanel", () => ({
  ModelDefaultsPanel: ({
    canEdit,
    localProviders,
  }: {
    canEdit: boolean;
    localProviders?: ReadonlySet<string>;
  }) => (
    <div data-testid="defaults-panel">
      {canEdit ? "editable" : "read-only"}
      <span data-testid="local-providers">{[...(localProviders ?? [])].join(",")}</span>
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  apiFetch.mockReset();
});

describe("ModelDefaultsPage", () => {
  it("gives the org admin the editable defaults, labelling self-hosted providers Local", async () => {
    apiFetch.mockResolvedValue([
      { id: "cloud", is_local: false },
      { id: "box", is_local: true },
    ]);
    render(<ModelDefaultsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Model defaults" })).toBeTruthy();
    expect(screen.getByTestId("defaults-panel").textContent).toMatch(/^editable/);
    await waitFor(() => expect(screen.getByTestId("local-providers").textContent).toBe("box"));
    expect(apiFetch).toHaveBeenCalledWith("/v1/model-providers", expect.anything());
  });

  it("still shows the defaults when the providers can't be listed", async () => {
    apiFetch.mockRejectedValue(new Error("down"));
    render(<ModelDefaultsPage />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(screen.getByTestId("defaults-panel")).toBeTruthy();
    expect(screen.getByTestId("local-providers").textContent).toBe("");
  });
});
