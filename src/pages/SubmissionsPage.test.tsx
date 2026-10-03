import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SubmissionsPage, type Submission } from "./SubmissionsPage";

const apiFetch = vi.fn();

vi.mock("../lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  friendlyErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
}));

// Mutable per test, same convention as AvailablePluginsPage.test.tsx.
let mockAuth = { token: "", isAuthenticated: false };
vi.mock("../lib/auth", () => ({
  useAuth: () => mockAuth,
}));

function submission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: "s1",
    name: "weather-plus",
    display_name: "Weather Plus",
    description: "A better weather plugin",
    author: "dev1",
    repository_url: null,
    distribution_type: "docker",
    docker_image: "org/weather-plus:latest",
    pricing_model: "free",
    base_tier: "community",
    status: "draft",
    review_notes: null,
    requires_services: [],
    ...overrides,
  };
}

describe("SubmissionsPage", () => {
  afterEach(() => {
    cleanup();
    apiFetch.mockReset();
  });

  it("prompts a logged-out user to log in instead of showing the form", () => {
    mockAuth = { token: "", isAuthenticated: false };
    render(<SubmissionsPage />);

    expect(
      screen.getByText(/Log in to submit a plugin/i),
    ).toBeTruthy();
    expect(screen.queryByText("Submit a new plugin")).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("loads and renders the caller's own submissions", async () => {
    mockAuth = { token: "tok", isAuthenticated: true };
    apiFetch.mockResolvedValue({ plugins: [submission()] });

    render(<SubmissionsPage />);

    await screen.findByText("Weather Plus");
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/marketplace/submissions/mine",
      expect.objectContaining({ token: "tok", signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByText("draft")).toBeTruthy();
  });

  it("creates a draft submission from the form", async () => {
    mockAuth = { token: "tok", isAuthenticated: true };
    apiFetch.mockResolvedValueOnce({ plugins: [] }); // initial load
    apiFetch.mockResolvedValueOnce({ id: "new-1" }); // create
    apiFetch.mockResolvedValueOnce({ plugins: [submission({ id: "new-1" })] }); // reload

    render(<SubmissionsPage />);
    await screen.findByText("You haven't submitted any plugins yet.");

    fireEvent.change(screen.getByLabelText("Name (slug)"), {
      target: { value: "weather-plus" },
    });
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Weather Plus" },
    });
    fireEvent.change(screen.getByLabelText("Author"), {
      target: { value: "dev1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create draft" }));

    await screen.findByText(/Draft created below/);
    expect(apiFetch).toHaveBeenCalledWith("/v1/marketplace/plugins", {
      method: "POST",
      token: "tok",
      body: expect.objectContaining({
        name: "weather-plus",
        display_name: "Weather Plus",
        author: "dev1",
        pricing_model: "free",
        distribution_type: "git",
        base_tier: "community",
      }),
    });
  });

  it("shows reviewer feedback and a resubmit button for a rejected submission", async () => {
    mockAuth = { token: "tok", isAuthenticated: true };
    apiFetch.mockResolvedValue({
      plugins: [
        submission({ status: "rejected", review_notes: "Fix the docker image tag" }),
      ],
    });

    render(<SubmissionsPage />);

    await screen.findByText(/Fix the docker image tag/);
    expect(
      screen.getByRole("button", { name: "Resubmit for review: Weather Plus" }),
    ).toBeTruthy();
  });

  it("submits a draft for review", async () => {
    mockAuth = { token: "tok", isAuthenticated: true };
    apiFetch.mockResolvedValueOnce({ plugins: [submission()] });
    apiFetch.mockResolvedValueOnce({}); // submit
    apiFetch.mockResolvedValueOnce({ plugins: [submission({ status: "submitted" })] });

    render(<SubmissionsPage />);
    await screen.findByText("Weather Plus");

    fireEvent.click(screen.getByRole("button", { name: "Submit for review: Weather Plus" }));

    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/v1/marketplace/submissions/s1/submit",
        { method: "POST", token: "tok" },
      ),
    );
  });

  it("does not show edit/submit controls for an approved submission", async () => {
    mockAuth = { token: "tok", isAuthenticated: true };
    apiFetch.mockResolvedValue({ plugins: [submission({ status: "approved" })] });

    render(<SubmissionsPage />);

    await screen.findByText("Weather Plus");
    expect(screen.queryByRole("button", { name: /^Edit/ })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /submit for review/i }),
    ).toBeNull();
  });
  it("shows a skeleton, not 'nothing submitted', while loading; an error offers Retry (#2195)", async () => {
    mockAuth = { token: "tok", isAuthenticated: true };
    let reject!: (e: unknown) => void;
    apiFetch.mockReturnValueOnce(new Promise((_, r) => (reject = r)));
    render(<SubmissionsPage />);

    expect(screen.getByTestId("card-list-skeleton")).toBeTruthy();
    expect(screen.queryByText("You haven't submitted any plugins yet.")).toBeNull();

    reject(new Error("marketplace down"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't load your submissions.");
    expect(screen.queryByText("You haven't submitted any plugins yet.")).toBeNull();

    apiFetch.mockResolvedValueOnce({ plugins: [] });
    fireEvent.click(screen.getByRole("button", { name: "Retry loading your submissions" }));
    expect(await screen.findByText("You haven't submitted any plugins yet.")).toBeTruthy();
  });

  it("names each submission's Edit and Submit buttons after it", async () => {
    mockAuth = { token: "tok", isAuthenticated: true };
    apiFetch.mockResolvedValue({ plugins: [submission()] });
    render(<SubmissionsPage />);

    expect(await screen.findByRole("button", { name: "Edit Weather Plus" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Submit for review: Weather Plus" })).toBeTruthy();
  });
  it("shows an in-review submission's status in its amber tone, not the neutral grey", async () => {
    mockAuth = { token: "tok", isAuthenticated: true };
    apiFetch.mockResolvedValue({ plugins: [submission({ status: "submitted" })] });
    render(<SubmissionsPage />);

    const badge = await screen.findByText("submitted");
    expect(badge.className.split(/\s+/).filter((c) => /^bg-/.test(c))).toEqual(["bg-amber-100"]);
  });
});
