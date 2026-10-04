import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReviewQueueResponse, ReviewSubmission } from "../lib/submissionReview";
import { ReviewQueuePage } from "./ReviewQueuePage";

const apiFetch = vi.fn();

vi.mock("../lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  friendlyErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
}));

// Mutable per test, same convention as AvailablePluginsPage.test.tsx.
let mockAuth = { token: "", role: "", isAuthenticated: false, sessionKey: 0 };
vi.mock("../lib/auth", () => ({
  useAuth: () => mockAuth,
}));

const QUEUE = "/v1/marketplace/submissions";
const queueUrl = (status: string) => `${QUEUE}?status=${status}&limit=100`;

/** A full `PluginResponse` row as the queue returns it. */
function submission(overrides: Partial<ReviewSubmission> = {}): ReviewSubmission {
  return {
    id: "6f1c1f0e-8a8e-4b7e-9d55-0c1d2e3f4a5b",
    name: "weather-plus",
    display_name: "Weather Plus",
    description: "A better weather plugin",
    author: "Acme Labs",
    repository_url: "https://github.com/acme/weather-plus",
    distribution_type: "hybrid",
    docker_image: "acme/weather-plus:1.2.0",
    current_version: "1.2.0",
    pricing_model: "free",
    base_tier: "community",
    status: "submitted",
    featured: false,
    download_count: 0,
    rating_average: null,
    rating_count: 0,
    created_at: "2026-09-30T08:15:00",
    updated_at: "2026-10-01T12:30:00",
    published_at: null,
    developer_id: null,
    category_id: null,
    requires_services: ["influxdb", "redis"],
    screenshots: ["https://img.example.com/weather-1.png"],
    origin: "submitted",
    submitted_by: "user-sub-1234",
    reviewed_by: "admin-sub-9",
    review_notes: "Please pin the image to a version tag.",
    ...overrides,
  };
}

/** A minimal row: only the fields the API always returns as non-null. */
function minimalSubmission(overrides: Partial<ReviewSubmission> = {}): ReviewSubmission {
  return {
    id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
    name: "bare",
    display_name: "Bare Plugin",
    status: "submitted",
    ...overrides,
  };
}

type Handler = (url: string, init: { method?: string; body?: unknown }) => unknown;

/** Route apiFetch by URL: `queue[status]` answers the list call (a value, an
 * Error to reject with, or a function for custom timing); POSTs go to `post`. */
function mockApi({
  queue = {},
  post,
}: {
  queue?: Record<string, ReviewQueueResponse | Error | (() => Promise<unknown>)>;
  post?: Handler;
}) {
  apiFetch.mockImplementation((url: string, init: { method?: string; body?: unknown } = {}) => {
    if (init.method === "POST") {
      return Promise.resolve(post ? post(url, init) : {});
    }
    const status = new URL(url, "http://x").searchParams.get("status") ?? "";
    const answer = queue[status] ?? { plugins: [], total: 0 };
    if (answer instanceof Error) return Promise.reject(answer);
    if (typeof answer === "function") return answer();
    return Promise.resolve(answer);
  });
}

function postCalls() {
  return apiFetch.mock.calls.filter(([, init]) => init?.method === "POST");
}

function listCalls() {
  return apiFetch.mock.calls.filter(([, init]) => init?.method !== "POST");
}

/** Let pending promises, timers and animation frames run, so a late second
 * request (or focus move) would have happened by the time we assert. */
async function settle() {
  await new Promise((r) => setTimeout(r, 50));
}

function asAdmin() {
  mockAuth = { token: "tok", role: "admin", isAuthenticated: true, sessionKey: 1 };
}

describe("ReviewQueuePage", () => {
  beforeEach(() => {
    asAdmin();
  });

  afterEach(() => {
    cleanup();
    apiFetch.mockReset();
  });

  describe("admin gating (unchanged)", () => {
    it("tells a non-admin the page is admins-only and never fetches", () => {
      mockAuth = { token: "tok", role: "user", isAuthenticated: true, sessionKey: 1 };
      render(<ReviewQueuePage />);

      expect(screen.getByText(/Admins only/)).toBeTruthy();
      expect(apiFetch).not.toHaveBeenCalled();
    });

    it("tells a logged-out visitor the page is admins-only and never fetches", () => {
      mockAuth = { token: "", role: "", isAuthenticated: false, sessionKey: 0 };
      render(<ReviewQueuePage />);

      expect(screen.getByText(/Admins only/)).toBeTruthy();
      expect(apiFetch).not.toHaveBeenCalled();
    });
  });

  describe("loading, empty and error states", () => {
    it("loads the submitted queue by default, at the backend's max page size", async () => {
      mockApi({ queue: { submitted: { plugins: [submission()], total: 1 } } });
      render(<ReviewQueuePage />);

      await screen.findByRole("heading", { name: "Weather Plus" });
      expect(apiFetch).toHaveBeenCalledWith(
        queueUrl("submitted"),
        expect.objectContaining({ token: "tok", signal: expect.any(AbortSignal) }),
      );
      expect(screen.getByText("1 submission (oldest submissions first).")).toBeTruthy();
    });

    it("shows a loading status and no empty-state message while the first load is in flight", async () => {
      let resolve!: (v: ReviewQueueResponse) => void;
      mockApi({
        queue: { submitted: () => new Promise((r) => (resolve = r)) },
      });
      render(<ReviewQueuePage />);

      expect(await screen.findByText("Loading submissions…")).toBeTruthy();
      expect(screen.queryByText(/No submissions/)).toBeNull();

      resolve({ plugins: [], total: 0 });
      await screen.findByText("No submissions are waiting for review.");
      expect(screen.queryByText("Loading submissions…")).toBeNull();
    });

    it("names the selected status in the empty state", async () => {
      mockApi({});
      render(<ReviewQueuePage />);
      await screen.findByText("No submissions are waiting for review.");

      fireEvent.change(screen.getByLabelText("Status"), { target: { value: "in_review" } });
      await screen.findByText('No submissions with the status "In review".');
    });

    it("shows the error with a retry, not the empty state, when the load fails", async () => {
      mockApi({ queue: { submitted: new Error("Service unavailable") } });
      render(<ReviewQueuePage />);

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toBe("Couldn't load submissions: Service unavailable");
      expect(screen.queryByText(/No submissions/)).toBeNull();

      mockApi({ queue: { submitted: { plugins: [submission()], total: 1 } } });
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));

      await screen.findByRole("heading", { name: "Weather Plus" });
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("doesn't show the last list under the error when a reload fails", async () => {
      mockApi({ queue: { submitted: { plugins: [submission()], total: 1 } } });
      render(<ReviewQueuePage />);
      fireEvent.click(await screen.findByRole("button", { name: "Claim Weather Plus" }));

      // The claim succeeds, but the reload after it fails.
      mockApi({ queue: { submitted: new Error("Gateway timeout") } });

      await screen.findByText("Couldn't load submissions: Gateway timeout");
      expect(screen.queryByRole("region", { name: "Weather Plus" })).toBeNull();
      expect(screen.queryByText(/oldest submissions first/)).toBeNull();
      expect(screen.queryByText(/No submissions/)).toBeNull();
      // The action's own result is still announced.
      expect(screen.getByText(/Claimed Weather Plus/)).toBeTruthy();
    });

    it("says when the queue holds more than one page", async () => {
      mockApi({
        queue: { submitted: { plugins: [submission()], total: 140 } },
      });
      render(<ReviewQueuePage />);

      await screen.findByText("Showing 1 of 140 (oldest submissions first).");
    });
  });

  describe("status filter", () => {
    it("offers the review statuses in sentence case, without the legacy pending", async () => {
      mockApi({});
      render(<ReviewQueuePage />);
      await screen.findByText("No submissions are waiting for review.");

      const options = within(screen.getByLabelText("Status")).getAllByRole("option");
      expect(options.map((o) => [o.getAttribute("value"), o.textContent])).toEqual([
        ["submitted", "Submitted"],
        ["in_review", "In review"],
        ["approved", "Approved"],
        ["rejected", "Rejected"],
        ["archived", "Archived"],
        ["draft", "Draft"],
      ]);
      expect(screen.queryByRole("option", { name: /pending/i })).toBeNull();
    });

    it("re-fetches for the chosen status and never shows the previous status's cards meanwhile", async () => {
      let resolveApproved!: (v: ReviewQueueResponse) => void;
      mockApi({
        queue: {
          submitted: { plugins: [submission()], total: 1 },
          approved: () => new Promise((r) => (resolveApproved = r)),
        },
      });
      render(<ReviewQueuePage />);
      await screen.findByRole("heading", { name: "Weather Plus" });

      fireEvent.change(screen.getByLabelText("Status"), { target: { value: "approved" } });

      await vi.waitFor(() =>
        expect(apiFetch).toHaveBeenCalledWith(
          queueUrl("approved"),
          expect.objectContaining({ token: "tok", signal: expect.any(AbortSignal) }),
        ),
      );
      expect(screen.queryByRole("heading", { name: "Weather Plus" })).toBeNull();
      expect(screen.getByText("Loading submissions…")).toBeTruthy();

      resolveApproved({
        plugins: [submission({ display_name: "Approved One", status: "approved" })],
        total: 1,
      });
      await screen.findByRole("heading", { name: "Approved One" });
    });

    it("still labels a legacy pending row correctly if the API returns one", async () => {
      mockApi({ queue: { submitted: { plugins: [submission({ status: "pending" })] } } });
      render(<ReviewQueuePage />);

      const card = await screen.findByRole("region", { name: "Weather Plus" });
      expect(within(card).getByText("Pending (legacy)")).toBeTruthy();
      expect(within(card).getByRole("button", { name: "Approve Weather Plus" })).toBeTruthy();
      expect(within(card).getByRole("button", { name: "Reject Weather Plus" })).toBeTruthy();
      expect(within(card).getByRole("button", { name: "Archive Weather Plus" })).toBeTruthy();
    });
  });

  describe("submission details", () => {
    it("nests headings under the page h1: cards are h2, their sections h3", async () => {
      mockApi({ queue: { submitted: { plugins: [submission()], total: 1 } } });
      render(<ReviewQueuePage />);

      expect(await screen.findByRole("heading", { level: 2, name: "Weather Plus" })).toBeTruthy();
      expect(screen.getByRole("heading", { level: 3, name: "What will run" })).toBeTruthy();
      expect(screen.getByRole("heading", { level: 3, name: "Submission" })).toBeTruthy();
      expect(screen.queryAllByRole("heading", { level: 4 })).toHaveLength(0);
    });

    it("shows everything a reviewer needs to judge a submission", async () => {
      mockApi({ queue: { submitted: { plugins: [submission()], total: 1 } } });
      render(<ReviewQueuePage />);

      const card = await screen.findByRole("region", { name: "Weather Plus" });
      const c = within(card);

      expect(c.getByText("weather-plus")).toBeTruthy();
      expect(c.getByText("A better weather plugin")).toBeTruthy();
      expect(c.getByText("Submitted")).toBeTruthy();

      // What will run.
      const runs = c.getByRole("region", { name: "What will run" });
      expect(within(runs).getByText("Hybrid (Git and Docker)")).toBeTruthy();
      expect(within(runs).getByText("acme/weather-plus:1.2.0")).toBeTruthy();
      expect(within(runs).getByText("1.2.0")).toBeTruthy();
      const repo = within(runs).getByRole("link", {
        name: "https://github.com/acme/weather-plus (opens in a new tab)",
      });
      expect(repo.getAttribute("href")).toBe("https://github.com/acme/weather-plus");
      expect(repo.getAttribute("target")).toBe("_blank");
      expect(repo.getAttribute("rel")).toBe("noopener noreferrer");
      const services = within(runs).getByRole("list", { name: "Required services" });
      expect(within(services).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
        "influxdb",
        "redis",
      ]);

      // Who and when.
      const meta = c.getByRole("region", { name: "Submission" });
      expect(within(meta).getByText("user-sub-1234")).toBeTruthy();
      expect(within(meta).getByText("Acme Labs")).toBeTruthy();
      expect(within(meta).getByText("Free · community tier")).toBeTruthy();
      expect(within(meta).getByText("admin-sub-9")).toBeTruthy();
      const times = Array.from(meta.querySelectorAll("time")).map((t) => t.getAttribute("dateTime"));
      // Naive-UTC timestamps from the API are read as UTC.
      expect(times).toEqual(["2026-09-30T08:15:00.000Z", "2026-10-01T12:30:00.000Z"]);
      expect(within(meta).queryByText("Published")).toBeNull();
      expect(
        within(meta).getByRole("link", { name: "Screenshot 1 (opens in a new tab)" }),
      ).toBeTruthy();

      // Previous review notes.
      expect(c.getByText("Previous reviewer feedback")).toBeTruthy();
      expect(c.getByText("Please pin the image to a version tag.")).toBeTruthy();

      // Full record: collapsed by default, readable JSON, text only.
      const summary = c.getByText("Full submission record (JSON)");
      const details = summary.closest("details")!;
      expect(details.open).toBe(false);
      fireEvent.click(summary);
      const pre = details.querySelector("pre")!;
      expect(JSON.parse(pre.textContent!)).toEqual(submission());
      expect(pre.textContent).toContain('\n  "docker_image": "acme/weather-plus:1.2.0"');
    });

    it("shows the published time when there is one", async () => {
      mockApi({
        queue: {
          approved: {
            plugins: [submission({ status: "approved", published_at: "2026-10-02T09:00:00Z" })],
          },
        },
      });
      render(<ReviewQueuePage />);
      fireEvent.change(screen.getByLabelText("Status"), { target: { value: "approved" } });

      const card = await screen.findByRole("region", { name: "Weather Plus" });
      expect(within(card).getByText("Published")).toBeTruthy();
      expect(card.querySelector('time[datetime="2026-10-02T09:00:00.000Z"]')).toBeTruthy();
    });

    it("leaves out missing optional fields instead of showing undefined or null", async () => {
      mockApi({ queue: { submitted: { plugins: [minimalSubmission()] } } });
      render(<ReviewQueuePage />);

      const card = await screen.findByRole("region", { name: "Bare Plugin" });
      const c = within(card);
      // Includes the raw JSON record, which holds only the fields received.
      const visibleText = (card.textContent ?? "").toLowerCase();

      expect(visibleText).not.toContain("undefined");
      expect(visibleText).not.toMatch(/\bnull\b/);
      expect(visibleText).not.toContain("nan");
      expect(visibleText).not.toContain("invalid date");
      for (const label of [
        "Distribution",
        "Docker image",
        "Repository",
        "Version",
        "Submitted by (user ID)",
        "Author (as declared)",
        "Pricing",
        "Created",
        "Last updated",
        "Published",
        "Last reviewer (user ID)",
        "Screenshots",
        "Previous reviewer feedback",
      ]) {
        expect(c.queryByText(label), label).toBeNull();
      }
      expect(c.queryByRole("link")).toBeNull();
      expect(c.getByText("None declared")).toBeTruthy();
      // No empty "Submission" section when none of its fields came back.
      expect(c.queryByRole("region", { name: "Submission" })).toBeNull();
      expect(c.getByRole("button", { name: "Claim Bare Plugin" })).toBeTruthy();
    });

    it("treats null and empty optional values like missing ones", async () => {
      mockApi({
        queue: {
          submitted: {
            plugins: [
              minimalSubmission({
                description: "",
                repository_url: null,
                docker_image: "  ",
                requires_services: [],
                review_notes: null,
                submitted_by: null,
                created_at: "not-a-date",
              }),
            ],
          },
        },
      });
      render(<ReviewQueuePage />);

      const card = await screen.findByRole("region", { name: "Bare Plugin" });
      const c = within(card);
      expect(c.queryByText("Docker image")).toBeNull();
      expect(c.queryByText("Repository")).toBeNull();
      expect(c.queryByText("Previous reviewer feedback")).toBeNull();
      expect(c.queryByText("Submitted by (user ID)")).toBeNull();
      // An unparseable timestamp is shown as received, not "Invalid Date".
      expect(c.getByText("not-a-date")).toBeTruthy();
      expect(card.textContent).not.toContain("Invalid Date");
    });

    it.each([
      "javascript:alert(document.cookie)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
    ])("never renders the unsafe repository URL %j as a link", async (url) => {
      mockApi({ queue: { submitted: { plugins: [submission({ repository_url: url })] } } });
      render(<ReviewQueuePage />);

      const card = await screen.findByRole("region", { name: "Weather Plus" });
      const runs = within(card).getByRole("region", { name: "What will run" });
      expect(within(runs).queryByRole("link")).toBeNull();
      expect(runs.querySelector(`a[href^="${url.split(":")[0]}"]`)).toBeNull();
      expect(within(runs).getByText(url)).toBeTruthy();
      expect(within(runs).getByText(/not linked: only http and https URLs without credentials open/)).toBeTruthy();
    });

    it("never injects markup from submission text", async () => {
      mockApi({
        queue: {
          submitted: {
            plugins: [
              submission({
                description: '<img src=x onerror="alert(1)">',
                review_notes: "<script>alert(1)</script>",
              }),
            ],
          },
        },
      });
      render(<ReviewQueuePage />);

      const card = await screen.findByRole("region", { name: "Weather Plus" });
      expect(card.querySelector("img")).toBeNull();
      expect(card.querySelector("script")).toBeNull();
      expect(within(card).getByText('<img src=x onerror="alert(1)">')).toBeTruthy();
    });
  });

  describe("reviewer actions", () => {
    it("explains in visible text why Approve isn't offered on a submitted item, and claims without a dialog", async () => {
      mockApi({ queue: { submitted: { plugins: [submission()] } } });
      render(<ReviewQueuePage />);

      const card = await screen.findByRole("region", { name: "Weather Plus" });
      const c = within(card);
      expect(c.queryByRole("button", { name: /^Approve/ })).toBeNull();
      expect(c.getByText(/Approve becomes available once it's in review/)).toBeTruthy();

      fireEvent.click(c.getByRole("button", { name: "Claim Weather Plus" }));

      await vi.waitFor(() => expect(postCalls()).toHaveLength(1));
      expect(postCalls()[0]).toEqual([
        `${QUEUE}/6f1c1f0e-8a8e-4b7e-9d55-0c1d2e3f4a5b/claim`,
        { method: "POST", token: "tok", body: undefined },
      ]);
      expect(screen.queryByRole("alertdialog")).toBeNull();
      await screen.findByText(/Claimed Weather Plus\. It's now under "In review"/);
      // The queue reloads after the action.
      await vi.waitFor(() => expect(listCalls()).toHaveLength(2));
    });

    it("sends exactly one request when Claim is clicked twice", async () => {
      mockApi({ queue: { submitted: { plugins: [submission()] } } });
      render(<ReviewQueuePage />);
      const claim = await screen.findByRole("button", { name: "Claim Weather Plus" });

      fireEvent.click(claim);
      fireEvent.click(claim);

      await screen.findByText(/Claimed Weather Plus/);
      await vi.waitFor(() => expect(listCalls()).toHaveLength(2));
      await settle();
      expect(postCalls()).toHaveLength(1);
    });

    it("moves focus to the result message after a successful action, not <body>", async () => {
      mockApi({ queue: { submitted: { plugins: [submission()] } } });
      render(<ReviewQueuePage />);
      const claim = await screen.findByRole("button", { name: "Claim Weather Plus" });
      claim.focus();

      mockApi({ queue: { submitted: { plugins: [] } } }); // the card leaves the list
      fireEvent.click(claim);

      await screen.findByText("No submissions are waiting for review.");
      await vi.waitFor(() =>
        expect(document.activeElement?.textContent).toMatch(/^Claimed Weather Plus\./),
      );
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement?.getAttribute("tabindex")).toBe("-1");
    });

    it("returns focus to Claim when the claim fails", async () => {
      mockApi({
        queue: { submitted: { plugins: [submission()] } },
        post: () => Promise.reject(new Error("Cannot move a submission")),
      });
      render(<ReviewQueuePage />);
      const claim = await screen.findByRole("button", { name: "Claim Weather Plus" });
      claim.focus();
      fireEvent.click(claim);

      await screen.findByText("Cannot move a submission");
      await vi.waitFor(() => expect(document.activeElement).toBe(claim));
      expect(claim.hasAttribute("disabled")).toBe(false);
    });

    it("names every action button after the plugin", async () => {
      mockApi({
        queue: {
          submitted: {
            plugins: [
              submission({ status: "in_review" }),
              submission({
                id: "11111111-1111-4111-8111-111111111111",
                display_name: "Other Plugin",
                status: "approved",
              }),
            ],
          },
        },
      });
      render(<ReviewQueuePage />);

      await screen.findByRole("button", { name: "Approve Weather Plus" });
      expect(screen.getByRole("button", { name: "Reject Weather Plus" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Archive Other Plugin" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    });

    it("shows visible text instead of buttons when no action applies", async () => {
      mockApi({ queue: { submitted: { plugins: [submission({ status: "rejected" })] } } });
      render(<ReviewQueuePage />);

      const card = await screen.findByRole("region", { name: "Weather Plus" });
      expect(within(card).queryAllByRole("button")).toHaveLength(0);
      expect(within(card).getByText(/waiting for the developer to address the feedback/)).toBeTruthy();
    });

    describe("approve", () => {
      async function openApprove() {
        mockApi({
          queue: { submitted: { plugins: [submission({ status: "in_review" })] } },
        });
        render(<ReviewQueuePage />);
        const button = await screen.findByRole("button", { name: "Approve Weather Plus" });
        button.focus();
        fireEvent.click(button);
        return { button, dialog: await screen.findByRole("alertdialog") };
      }

      it("asks for confirmation and summarises what will run", async () => {
        const { dialog } = await openApprove();

        expect(dialog.getAttribute("aria-modal")).toBe("true");
        expect(within(dialog).getByRole("heading", { name: 'Approve "Weather Plus"?' })).toBeTruthy();
        expect(dialog.textContent).toContain("It runs the Docker image acme/weather-plus:1.2.0.");
        expect(dialog.textContent).toContain("It requires these services: influxdb, redis.");
        // Initial focus is inside the dialog.
        expect(dialog.contains(document.activeElement)).toBe(true);
        expect(postCalls()).toHaveLength(0);
      });

      it("sends nothing on cancel and returns focus to the Approve button", async () => {
        const { button, dialog } = await openApprove();

        fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

        await vi.waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
        expect(postCalls()).toHaveLength(0);
        await vi.waitFor(() => expect(document.activeElement).toBe(button));
      });

      it("sends nothing when Escape dismisses the dialog", async () => {
        const { dialog } = await openApprove();

        fireEvent.keyDown(within(dialog).getByRole("button", { name: "Approve" }), {
          key: "Escape",
        });

        await vi.waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
        expect(postCalls()).toHaveLength(0);
      });

      it("keeps Tab inside the dialog", async () => {
        const { dialog } = await openApprove();
        const confirmButton = within(dialog).getByRole("button", { name: "Approve" });
        const cancelButton = within(dialog).getByRole("button", { name: "Cancel" });
        expect(document.activeElement).toBe(confirmButton);

        fireEvent.keyDown(confirmButton, { key: "Tab" });
        expect(document.activeElement).toBe(cancelButton);
      });

      it("approves on confirm and announces the result", async () => {
        const { dialog } = await openApprove();

        fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));

        await vi.waitFor(() => expect(postCalls()).toHaveLength(1));
        expect(postCalls()[0]).toEqual([
          `${QUEUE}/6f1c1f0e-8a8e-4b7e-9d55-0c1d2e3f4a5b/approve`,
          { method: "POST", token: "tok", body: undefined },
        ]);
        await screen.findByText("Approved Weather Plus. It's now listed in the catalog.");
      });

      it("shows the API's error on the card when approving fails", async () => {
        const { dialog } = await openApprove();
        mockApi({
          queue: { submitted: { plugins: [submission({ status: "in_review" })] } },
          post: () =>
            Promise.reject(new Error("Submission status changed concurrently; re-read and retry")),
        });

        fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));

        const card = screen.getByRole("region", { name: "Weather Plus" });
        await vi.waitFor(() =>
          expect(within(card).getByRole("alert").textContent).toBe(
            "Submission status changed concurrently; re-read and retry",
          ),
        );
        // Buttons are usable again, and focus is back on Approve.
        const approve = within(card).getByRole("button", { name: "Approve Weather Plus" });
        expect(approve.hasAttribute("disabled")).toBe(false);
        await vi.waitFor(() => expect(document.activeElement).toBe(approve));
      });

      it("moves focus to the result message once approved", async () => {
        const { dialog } = await openApprove();
        mockApi({ queue: { submitted: { plugins: [] } } });

        fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));

        await vi.waitFor(() =>
          expect(document.activeElement?.textContent).toBe(
            "Approved Weather Plus. It's now listed in the catalog.",
          ),
        );
      });

      it("sends exactly one approve when the confirm button is double-clicked", async () => {
        const { dialog } = await openApprove();
        const confirmButton = within(dialog).getByRole("button", { name: "Approve" });

        fireEvent.click(confirmButton);
        fireEvent.click(confirmButton);

        await screen.findByText("Approved Weather Plus. It's now listed in the catalog.");
        await vi.waitFor(() => expect(listCalls()).toHaveLength(2));
        await settle();
        expect(postCalls()).toHaveLength(1);
      });
    });

    describe("archive", () => {
      async function openArchive() {
        mockApi({ queue: { submitted: { plugins: [submission({ status: "approved" })] } } });
        render(<ReviewQueuePage />);
        const button = await screen.findByRole("button", { name: "Archive Weather Plus" });
        button.focus();
        fireEvent.click(button);
        return { button, dialog: await screen.findByRole("alertdialog") };
      }

      it("asks for confirmation and says archiving is final", async () => {
        const { dialog } = await openArchive();

        expect(within(dialog).getByRole("heading", { name: 'Archive "Weather Plus"?' })).toBeTruthy();
        expect(dialog.textContent).toMatch(/final status/);
        expect(postCalls()).toHaveLength(0);
      });

      it("sends nothing on cancel and returns focus to the Archive button", async () => {
        const { button, dialog } = await openArchive();

        fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

        await vi.waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
        expect(postCalls()).toHaveLength(0);
        await vi.waitFor(() => expect(document.activeElement).toBe(button));
      });

      it("sends nothing when Escape dismisses the dialog, and refocuses Archive", async () => {
        const { button, dialog } = await openArchive();

        fireEvent.keyDown(within(dialog).getByRole("button", { name: "Archive" }), {
          key: "Escape",
        });

        await vi.waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
        await settle();
        expect(postCalls()).toHaveLength(0);
        expect(document.activeElement).toBe(button);
      });

      it("archives on confirm", async () => {
        const { dialog } = await openArchive();

        fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }));

        await vi.waitFor(() => expect(postCalls()).toHaveLength(1));
        expect(postCalls()[0]).toEqual([
          `${QUEUE}/6f1c1f0e-8a8e-4b7e-9d55-0c1d2e3f4a5b/archive`,
          { method: "POST", token: "tok", body: undefined },
        ]);
        await screen.findByText("Archived Weather Plus. It's no longer listed in the catalog.");
      });
    });

    describe("reject", () => {
      async function openReject() {
        mockApi({ queue: { submitted: { plugins: [submission({ status: "in_review" })] } } });
        render(<ReviewQueuePage />);
        fireEvent.click(await screen.findByRole("button", { name: "Reject Weather Plus" }));
        return screen.getByLabelText("Feedback for the developer (required)");
      }

      it("requires feedback, and says so in visible text", async () => {
        const notes = await openReject();
        const confirmButton = screen.getByRole("button", { name: "Confirm reject Weather Plus" });

        expect(document.activeElement).toBe(notes);
        expect(notes.hasAttribute("required")).toBe(true);
        expect(confirmButton.hasAttribute("disabled")).toBe(true);
        const hint = document.getElementById(notes.getAttribute("aria-describedby")!)!;
        expect(hint.textContent).toMatch(/Write feedback to enable Confirm reject/);

        // Whitespace alone isn't feedback.
        fireEvent.change(notes, { target: { value: "   " } });
        expect(confirmButton.hasAttribute("disabled")).toBe(true);
        fireEvent.submit(notes.closest("form")!);
        expect(postCalls()).toHaveLength(0);

        fireEvent.change(notes, { target: { value: "  Please fix X  " } });
        expect(confirmButton.hasAttribute("disabled")).toBe(false);

        fireEvent.click(confirmButton);

        await vi.waitFor(() => expect(postCalls()).toHaveLength(1));
        expect(postCalls()[0]).toEqual([
          `${QUEUE}/6f1c1f0e-8a8e-4b7e-9d55-0c1d2e3f4a5b/reject`,
          { method: "POST", token: "tok", body: { notes: "Please fix X" } },
        ]);
        await screen.findByText("Rejected Weather Plus. The developer can see your feedback.");
      });

      it("sends exactly one reject when the form is submitted twice", async () => {
        const notes = await openReject();
        fireEvent.change(notes, { target: { value: "Please fix X" } });
        const form = notes.closest("form")!;

        fireEvent.submit(form);
        fireEvent.submit(form);

        await screen.findByText(/Rejected Weather Plus/);
        await vi.waitFor(() => expect(listCalls()).toHaveLength(2));
        await settle();
        expect(postCalls()).toHaveLength(1);
      });

      it("keeps the feedback and refocuses Confirm reject when rejecting fails", async () => {
        const notes = await openReject();
        mockApi({
          queue: { submitted: { plugins: [submission({ status: "in_review" })] } },
          post: () => Promise.reject(new Error("review notes are required when rejecting")),
        });
        fireEvent.change(notes, { target: { value: "Please fix X" } });
        const confirmButton = screen.getByRole("button", { name: "Confirm reject Weather Plus" });
        fireEvent.click(confirmButton);

        await screen.findByText("review notes are required when rejecting");
        expect((notes as HTMLTextAreaElement).value).toBe("Please fix X");
        await vi.waitFor(() => expect(document.activeElement).toBe(confirmButton));
      });

      it("cancels with Escape, sends nothing, and refocuses Reject", async () => {
        const notes = await openReject();
        fireEvent.change(notes, { target: { value: "draft feedback" } });

        fireEvent.keyDown(notes, { key: "Escape" });

        expect(screen.queryByLabelText("Feedback for the developer (required)")).toBeNull();
        const reject = screen.getByRole("button", { name: "Reject Weather Plus" });
        await vi.waitFor(() => expect(document.activeElement).toBe(reject));
        expect(postCalls()).toHaveLength(0);
      });

      it("cancels with the Cancel button", async () => {
        await openReject();
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

        expect(screen.queryByLabelText("Feedback for the developer (required)")).toBeNull();
        expect(postCalls()).toHaveLength(0);
      });
    });
  });
});
