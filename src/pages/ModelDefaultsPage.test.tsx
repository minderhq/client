import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { myPermissions, SERVER_SESSION, serveMyPermissions } from "../test/myPermissions";

import { ModelDefaultsPage } from "./ModelDefaultsPage";

const apiFetch = vi.fn();
vi.mock("../lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  friendlyErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
}));
const ORG_ADMIN = { token: "tok", sessionKey: "s1", isAuthenticated: true, role: "user", orgRole: "admin" };
let mockAuth: Record<string, unknown> = ORG_ADMIN;
vi.mock("../lib/auth", () => ({
  useAuth: () => mockAuth,
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
  mockAuth = ORG_ADMIN;
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

  it("shows a plain member the defaults read-only, without listing providers", () => {
    mockAuth = { ...ORG_ADMIN, orgRole: "member" };
    render(<ModelDefaultsPage />);
    expect(screen.getByTestId("defaults-panel").textContent).toMatch(/^read-only/);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("lets a role with only org.ai.defaults.manage edit the defaults", async () => {
    mockAuth = { token: "tok", role: "user", orgRole: "Defaults editor", ...SERVER_SESSION };
    apiFetch.mockResolvedValue([]);
    serveMyPermissions(apiFetch, myPermissions({ orgKeys: ["org.ai.defaults.manage"] }));
    render(<ModelDefaultsPage />);
    await waitFor(() =>
      expect(screen.getByTestId("defaults-panel").textContent).toMatch(/^editable/),
    );
  });

  it("keeps the defaults read-only for an org admin whose role lacks org.ai.defaults.manage", async () => {
    mockAuth = { ...ORG_ADMIN, ...SERVER_SESSION };
    apiFetch.mockResolvedValue([]);
    serveMyPermissions(
      apiFetch,
      myPermissions({ orgRole: "admin", orgKeys: ["org.ai.providers.view", "org.ai.providers.manage"] }),
    );
    render(<ModelDefaultsPage />);
    await waitFor(() =>
      expect(screen.getByTestId("defaults-panel").textContent).toMatch(/^read-only/),
    );
  });

  it("lets a Platform Admin edit the defaults", () => {
    mockAuth = { ...ORG_ADMIN, orgRole: "member", isPlatformAdmin: true };
    apiFetch.mockResolvedValue([]);
    render(<ModelDefaultsPage />);
    expect(screen.getByTestId("defaults-panel").textContent).toMatch(/^editable/);
  });
});
