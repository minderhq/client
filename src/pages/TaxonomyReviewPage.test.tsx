import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaxonomyReviewPage } from "./TaxonomyReviewPage";

const apiFetch = vi.fn();

vi.mock("../lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  friendlyErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
}));

// Mutable per test, same convention as ReviewQueuePage.test.tsx.
let mockAuth = { token: "", isAuthenticated: false };
vi.mock("../lib/auth", () => ({
  useAuth: () => mockAuth,
}));

function candidate(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "c1",
    entity: "Elon Musk",
    label: "PERSON",
    category: "Entrepreneur",
    confidence: 0.82,
    votes: 3,
    model: "llama3.2",
    owner_id: "alice",
    ...overrides,
  };
}

describe("TaxonomyReviewPage", () => {
  afterEach(() => {
    apiFetch.mockReset();
    cleanup();
  });

  it("tells a logged-out visitor to log in and never fetches", () => {
    mockAuth = { token: "", isAuthenticated: false };
    render(<TaxonomyReviewPage />);

    expect(screen.getByText(/Log in to review/)).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("shows a loading status while the queue fetches", () => {
    mockAuth = { token: "tok", isAuthenticated: true };
    apiFetch.mockReturnValue(new Promise(() => {})); // never resolves

    render(<TaxonomyReviewPage />);

    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows an empty state when the queue has no candidates", async () => {
    mockAuth = { token: "tok", isAuthenticated: true };
    apiFetch.mockResolvedValue({ success: true, candidates: [] });

    render(<TaxonomyReviewPage />);

    await screen.findByText("No pending taxonomy suggestions right now.");
  });

  it("renders a candidate card with its confidence and vote count", async () => {
    mockAuth = { token: "tok", isAuthenticated: true };
    apiFetch.mockResolvedValue({ success: true, candidates: [candidate()] });

    render(<TaxonomyReviewPage />);

    await screen.findByText("Elon Musk");
    expect(screen.getByText(/Entrepreneur/)).toBeTruthy();
    expect(screen.getByText("82% confidence")).toBeTruthy();
    expect(screen.getByText(/3\/3 votes agreed/)).toBeTruthy();
  });

  it("surfaces a queue-load error as an alert", async () => {
    mockAuth = { token: "tok", isAuthenticated: true };
    apiFetch.mockRejectedValue(new Error("boom"));

    render(<TaxonomyReviewPage />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("boom");
  });

  it("approves a candidate and reloads the queue", async () => {
    mockAuth = { token: "tok", isAuthenticated: true };
    apiFetch.mockResolvedValueOnce({ success: true, candidates: [candidate()] });
    apiFetch.mockResolvedValueOnce({}); // approve
    apiFetch.mockResolvedValueOnce({ success: true, candidates: [] });

    render(<TaxonomyReviewPage />);
    await screen.findByRole("button", { name: "Approve" });

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/v1/graph-rag/graph/taxonomy/review-queue/c1/approve",
        { method: "POST", token: "tok" },
      ),
    );
    await screen.findByText("No pending taxonomy suggestions right now.");
  });

  it("rejects a candidate and reloads the queue", async () => {
    mockAuth = { token: "tok", isAuthenticated: true };
    apiFetch.mockResolvedValueOnce({ success: true, candidates: [candidate()] });
    apiFetch.mockResolvedValueOnce({}); // reject
    apiFetch.mockResolvedValueOnce({ success: true, candidates: [] });

    render(<TaxonomyReviewPage />);
    await screen.findByRole("button", { name: "Reject" });

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/v1/graph-rag/graph/taxonomy/review-queue/c1/reject",
        { method: "POST", token: "tok" },
      ),
    );
    await screen.findByText("No pending taxonomy suggestions right now.");
  });

  it("shows an error alert and re-enables the buttons if approve fails", async () => {
    mockAuth = { token: "tok", isAuthenticated: true };
    apiFetch.mockResolvedValueOnce({ success: true, candidates: [candidate()] });
    apiFetch.mockRejectedValueOnce(new Error("action failed"));

    render(<TaxonomyReviewPage />);
    const approveButton = await screen.findByRole("button", { name: "Approve" });

    fireEvent.click(approveButton);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("action failed");
    expect(approveButton.hasAttribute("disabled")).toBe(false);
  });
});
