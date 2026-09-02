import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EntityMergeReviewPage } from "./EntityMergeReviewPage";

const apiFetch = vi.fn();

vi.mock("../lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  friendlyErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
}));

// Mutable per test — includes isPlatformAdmin, which gates the Detect action.
let mockAuth = { token: "", isAuthenticated: false, isPlatformAdmin: false };
vi.mock("../lib/auth", () => ({
  useAuth: () => mockAuth,
}));

function candidate(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "c1",
    entity_a: "Acme Corp",
    entity_b: "ACME Corporation",
    label: "ORG",
    confidence: 0.91,
    evidence: "high embedding similarity",
    owner_a: "org-1",
    owner_b: "org-2",
    approvals: [],
    ...overrides,
  };
}

describe("EntityMergeReviewPage", () => {
  afterEach(() => {
    apiFetch.mockReset();
    cleanup();
  });

  it("tells a logged-out visitor to log in and never fetches", () => {
    mockAuth = { token: "", isAuthenticated: false, isPlatformAdmin: false };
    render(<EntityMergeReviewPage />);
    expect(screen.getByText(/Log in to review/)).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("renders a candidate with its entities, similarity, owners and approvals", async () => {
    mockAuth = { token: "tok", isAuthenticated: true, isPlatformAdmin: false };
    apiFetch.mockResolvedValue({ success: true, candidates: [candidate()] });
    render(<EntityMergeReviewPage />);

    await screen.findByText("Acme Corp");
    expect(screen.getByText("ACME Corporation")).toBeTruthy();
    expect(screen.getByText("91% similar")).toBeTruthy();
    expect(screen.getByText(/Owners: org-1 · org-2/)).toBeTruthy();
    expect(screen.getByText(/0 of 2 approvals/)).toBeTruthy();
  });

  it("hides the Detect action for a non-platform-admin", async () => {
    mockAuth = { token: "tok", isAuthenticated: true, isPlatformAdmin: false };
    apiFetch.mockResolvedValue({ success: true, candidates: [] });
    render(<EntityMergeReviewPage />);
    await screen.findByText(/No pending entity-merge candidates/);
    expect(screen.queryByRole("button", { name: /Detect candidates/ })).toBeNull();
  });

  it("approve that leaves it pending explains the dual-control wait", async () => {
    mockAuth = { token: "tok", isAuthenticated: true, isPlatformAdmin: false };
    apiFetch.mockResolvedValueOnce({ success: true, candidates: [candidate()] });
    apiFetch.mockResolvedValueOnce({ success: true, id: "c1", status: "pending", approvals: ["me"] });
    apiFetch.mockResolvedValueOnce({ success: true, candidates: [candidate({ approvals: ["me"] })] });

    render(<EntityMergeReviewPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve merge" }));

    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/v1/graph-rag/graph/candidates/c1/review",
        { method: "POST", body: { decision: "approve" }, token: "tok" },
      ),
    );
    await screen.findByText(/still needs the other owner/);
  });

  it("lets a platform admin run detection, then reloads the queue", async () => {
    mockAuth = { token: "tok", isAuthenticated: true, isPlatformAdmin: true };
    apiFetch.mockResolvedValueOnce({ success: true, candidates: [] }); // initial load
    apiFetch.mockResolvedValueOnce({ success: true, candidates: 2 }); // detect
    apiFetch.mockResolvedValueOnce({ success: true, candidates: [candidate()] }); // reload

    render(<EntityMergeReviewPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Detect candidates/ }));

    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/v1/graph-rag/graph/candidates/detect",
        { method: "POST", token: "tok" },
      ),
    );
    await screen.findByText(/Found 2 new candidates/);
    await screen.findByText("Acme Corp");
  });

  it("surfaces a queue-load error as an alert", async () => {
    mockAuth = { token: "tok", isAuthenticated: true, isPlatformAdmin: false };
    apiFetch.mockRejectedValue(new Error("boom"));
    render(<EntityMergeReviewPage />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("boom");
  });
});
