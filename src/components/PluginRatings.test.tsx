import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PluginRatings, type PluginRating } from "./PluginRatings";

// A local stand-in for lib/api's ApiError so the component's
// `e instanceof ApiError && e.status === 403` gate is exercised for real (the
// same instance shape the mocked apiFetch rejects with below). Defined via
// vi.hoisted so it's initialized before the hoisted vi.mock factory reads it.
const { ApiError } = vi.hoisted(() => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return { ApiError };
});

const apiFetch = vi.fn();
vi.mock("../lib/api", () => ({
  ApiError,
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  friendlyErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
}));

// The component reads the caller's own id from the JWT to spot "your" review.
// "mytoken" decodes to user u1; anything else is anonymous.
vi.mock("../lib/jwt", () => ({
  decodeJwtClaims: (token: string) => ({ userId: token === "mytoken" ? "u1" : "" }),
}));

function rating(overrides: Partial<PluginRating> = {}): PluginRating {
  return {
    id: "r1",
    plugin_id: "p1",
    user_id: "someone-else",
    rating: 4,
    review_text: "Solid plugin",
    created_at: "2026-02-01T00:00:00Z",
    updated_at: "2026-02-01T00:00:00Z",
    ...overrides,
  };
}

function ratingsResponse(overrides: {
  rating_average?: number | null;
  rating_count?: number;
  ratings?: PluginRating[];
} = {}) {
  const ratings = overrides.ratings ?? [rating()];
  return {
    plugin_id: "p1",
    rating_average: overrides.rating_average ?? 4,
    rating_count: overrides.rating_count ?? ratings.length,
    ratings,
  };
}

function renderPanel(props: {
  token?: string;
  isAuthenticated?: boolean;
  isInstalled?: boolean;
} = {}) {
  const result = render(
    <PluginRatings
      pluginId="p1"
      token={props.token ?? ""}
      isAuthenticated={props.isAuthenticated ?? false}
      isInstalled={props.isInstalled ?? false}
    />,
  );
  return result;
}

// Opens the <details> disclosure and waits for the initial GET to settle.
async function openPanel(container: HTMLElement) {
  const details = container.querySelector("details")!;
  fireEvent.click(container.querySelector("summary")!);
  await waitFor(() => expect(details.open).toBe(true));
  return details;
}

describe("PluginRatings", () => {
  afterEach(() => {
    cleanup();
    apiFetch.mockReset();
  });

  it("lazily loads the aggregate and reviews list when the panel opens", async () => {
    apiFetch.mockResolvedValue(
      ratingsResponse({ rating_average: 4.5, rating_count: 2, ratings: [rating()] }),
    );
    const { container } = renderPanel();

    // Nothing is fetched until the disclosure is opened.
    expect(apiFetch).not.toHaveBeenCalled();

    await openPanel(container);

    await screen.findByText(/average across 2 reviews/);
    expect(apiFetch).toHaveBeenCalledWith("/v1/marketplace/plugins/p1/ratings");
    expect(screen.getByText("Solid plugin")).toBeTruthy();
  });

  it("shows an empty-aggregate message and no-reviews state when there are none", async () => {
    apiFetch.mockResolvedValue(
      ratingsResponse({ rating_average: null, rating_count: 0, ratings: [] }),
    );
    const { container } = renderPanel();
    await openPanel(container);

    await screen.findByText(/be the first to rate this plugin/);
    expect(screen.getByText("No written reviews yet.")).toBeTruthy();
  });

  it("prompts to log in when unauthenticated, with no submit form", async () => {
    apiFetch.mockResolvedValue(ratingsResponse());
    const { container } = renderPanel({ isAuthenticated: false });
    await openPanel(container);

    await screen.findByText("Log in to review this plugin.");
    expect(screen.queryByLabelText("Your review")).toBeNull();
  });

  it("install-gates the form for an authenticated user who hasn't installed it", async () => {
    apiFetch.mockResolvedValue(ratingsResponse({ ratings: [] }));
    const { container } = renderPanel({
      token: "mytoken",
      isAuthenticated: true,
      isInstalled: false,
    });
    await openPanel(container);

    await screen.findByText("Install to review");
    // Star buttons and the submit button are inert until installed.
    expect(
      (screen.getByRole("radio", { name: "5 stars" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Submit review" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByLabelText("Your review").hasAttribute("disabled")).toBe(true);
  });

  it("submits a new rating (no user id in the body) and refreshes the aggregate", async () => {
    // First GET: no reviews. POST resolves. Second GET (refresh): now one review.
    apiFetch
      .mockResolvedValueOnce(ratingsResponse({ rating_average: null, rating_count: 0, ratings: [] }))
      .mockResolvedValueOnce(rating({ user_id: "u1", rating: 5, review_text: "Great!" }))
      .mockResolvedValueOnce(
        ratingsResponse({
          rating_average: 5,
          rating_count: 1,
          ratings: [rating({ id: "mine", user_id: "u1", rating: 5, review_text: "Great!" })],
        }),
      );
    const { container } = renderPanel({
      token: "mytoken",
      isAuthenticated: true,
      isInstalled: true,
    });
    await openPanel(container);
    await screen.findByRole("button", { name: "Submit review" });

    fireEvent.click(screen.getByRole("radio", { name: "5 stars" }));
    fireEvent.change(screen.getByLabelText("Your review"), {
      target: { value: "Great!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));

    await screen.findByText("Thanks for your review!");
    expect(apiFetch).toHaveBeenCalledWith("/v1/marketplace/plugins/p1/ratings", {
      method: "POST",
      body: { rating: 5, review_text: "Great!" },
      token: "mytoken",
    });
    // The POST body carries no user_id — the server derives it from the JWT.
    const postCall = apiFetch.mock.calls.find((c) => c[1]?.method === "POST");
    expect(postCall?.[1].body).not.toHaveProperty("user_id");
    // Refreshed list now shows the new review, marked as the caller's own.
    await screen.findByText("Your review ·");
  });

  it("pre-loads the caller's existing review and updates it (upsert)", async () => {
    apiFetch
      .mockResolvedValueOnce(
        ratingsResponse({
          rating_average: 3,
          rating_count: 1,
          ratings: [rating({ id: "mine", user_id: "u1", rating: 3, review_text: "It was ok" })],
        }),
      )
      .mockResolvedValueOnce(rating({ id: "mine", user_id: "u1", rating: 4, review_text: "It was ok" }))
      .mockResolvedValueOnce(
        ratingsResponse({
          rating_average: 4,
          rating_count: 1,
          ratings: [rating({ id: "mine", user_id: "u1", rating: 4, review_text: "It was ok" })],
        }),
      );
    const { container } = renderPanel({
      token: "mytoken",
      isAuthenticated: true,
      isInstalled: true,
    });
    await openPanel(container);

    // Existing review seeds the form: button reflects an edit and the textarea
    // is pre-filled.
    await screen.findByRole("button", { name: "Update review" });
    expect((screen.getByLabelText("Your review") as HTMLTextAreaElement).value).toBe(
      "It was ok",
    );
    expect(screen.getByText("Editing your review")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "4 stars" }));
    fireEvent.click(screen.getByRole("button", { name: "Update review" }));

    await screen.findByText("Review updated.");
    expect(apiFetch).toHaveBeenCalledWith("/v1/marketplace/plugins/p1/ratings", {
      method: "POST",
      body: { rating: 4, review_text: "It was ok" },
      token: "mytoken",
    });
  });

  it("handles a 403 on submit by surfacing the install gate instead of a raw error", async () => {
    // isInstalled is stale-true, but the server still rejects with 403.
    apiFetch
      .mockResolvedValueOnce(ratingsResponse({ ratings: [] }))
      .mockRejectedValueOnce(
        new ApiError("Install this plugin before reviewing it.", 403),
      );
    const { container } = renderPanel({
      token: "mytoken",
      isAuthenticated: true,
      isInstalled: true,
    });
    await openPanel(container);
    await screen.findByRole("button", { name: "Submit review" });

    fireEvent.click(screen.getByRole("radio", { name: "5 stars" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));

    await screen.findByText("Install this plugin before reviewing it.");
    // After the gate trips, the form is locked back down.
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Submit review" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true),
    );
    expect(screen.getByText("Install to review")).toBeTruthy();
  });

  it("shows a load error when the ratings GET fails", async () => {
    apiFetch.mockRejectedValue(new Error("boom"));
    const { container } = renderPanel();
    await openPanel(container);

    await screen.findByText("boom");
  });
});
