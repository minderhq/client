import { describe, expect, it } from "vitest";

import {
  REVIEW_STATUS_FILTERS,
  approveConfirmMessage,
  archiveConfirmMessage,
  distributionLabel,
  nonEmptyStrings,
  parseServerTimestamp,
  reviewerActionHint,
  reviewerActionsFor,
  submissionStatusLabel,
  type ReviewSubmission,
} from "./submissionReview";

function submission(overrides: Partial<ReviewSubmission> = {}): ReviewSubmission {
  return {
    id: "6f1c1f0e-8a8e-4b7e-9d55-0c1d2e3f4a5b",
    name: "weather-plus",
    display_name: "Weather Plus",
    status: "in_review",
    ...overrides,
  };
}

describe("REVIEW_STATUS_FILTERS", () => {
  it("offers every #402 status a reviewer can filter on, and not the legacy pending", () => {
    expect([...REVIEW_STATUS_FILTERS]).toEqual([
      "submitted",
      "in_review",
      "approved",
      "rejected",
      "archived",
      "draft",
    ]);
    expect(REVIEW_STATUS_FILTERS).not.toContain("pending");
  });
});

describe("submissionStatusLabel", () => {
  it("uses sentence case for known statuses", () => {
    expect(submissionStatusLabel("in_review")).toBe("In review");
    expect(submissionStatusLabel("submitted")).toBe("Submitted");
  });

  it("still labels the legacy pending status if the API returns it", () => {
    expect(submissionStatusLabel("pending")).toBe("Pending (legacy)");
  });

  it("shows an unknown status readably instead of dropping it", () => {
    expect(submissionStatusLabel("needs_changes")).toBe("Needs changes");
  });

  it("doesn't resolve inherited object keys as statuses", () => {
    expect(submissionStatusLabel("toString")).toBe("ToString");
  });
});

describe("reviewerActionsFor", () => {
  // core/review.py ALLOWED_TRANSITIONS, reviewer side.
  it.each([
    ["submitted", ["claim", "reject"]],
    ["in_review", ["approve", "reject"]],
    ["approved", ["archive"]],
    ["pending", ["approve", "reject", "archive"]],
    ["draft", []],
    ["rejected", []],
    ["archived", []],
    ["something_new", []],
  ])("%s -> %j", (status, expected) => {
    expect(reviewerActionsFor(status)).toEqual(expected);
  });

  it("explains every status in visible text", () => {
    for (const s of [...REVIEW_STATUS_FILTERS, "pending", "unknown"]) {
      expect(reviewerActionHint(s).length).toBeGreaterThan(0);
    }
    expect(reviewerActionHint("submitted")).toMatch(/Approve becomes available once it's in review/);
  });
});

describe("distributionLabel", () => {
  it("names each distribution type and passes unknown values through", () => {
    expect(distributionLabel("git")).toBe("Git repository");
    expect(distributionLabel("docker")).toBe("Docker image");
    expect(distributionLabel("hybrid")).toBe("Hybrid (Git and Docker)");
    expect(distributionLabel("oci")).toBe("oci");
  });

  it("returns null when there's nothing to show", () => {
    expect(distributionLabel(null)).toBeNull();
    expect(distributionLabel(undefined)).toBeNull();
    expect(distributionLabel("")).toBeNull();
  });
});

describe("nonEmptyStrings", () => {
  it("keeps non-blank strings only", () => {
    expect(nonEmptyStrings(["influxdb", "", "  ", null, 3, "redis"])).toEqual([
      "influxdb",
      "redis",
    ]);
  });

  it("treats a missing or non-array value as empty", () => {
    expect(nonEmptyStrings(undefined)).toEqual([]);
    expect(nonEmptyStrings(null)).toEqual([]);
    expect(nonEmptyStrings("influxdb")).toEqual([]);
  });
});

describe("approveConfirmMessage", () => {
  it("summarises the image, repository and required services", () => {
    const msg = approveConfirmMessage(
      submission({
        distribution_type: "hybrid",
        docker_image: "acme/weather-plus:1.2.0",
        repository_url: "https://github.com/acme/weather-plus",
        requires_services: ["influxdb", "redis"],
      }),
    );
    expect(msg).toContain('"Weather Plus" (weather-plus)');
    expect(msg).toContain("It runs the Docker image acme/weather-plus:1.2.0.");
    expect(msg).toContain("Source repository: https://github.com/acme/weather-plus.");
    expect(msg).toContain("It requires these services: influxdb, redis.");
  });

  it("calls out a Docker distribution with no image, and no required services", () => {
    const msg = approveConfirmMessage(
      submission({ distribution_type: "docker", docker_image: null, requires_services: [] }),
    );
    expect(msg).toContain("It doesn't declare a Docker image.");
    expect(msg).toContain("It doesn't declare any required services.");
    expect(msg).not.toContain("undefined");
    expect(msg).not.toContain("null");
  });

  it("doesn't mention an image for a git plugin without one", () => {
    const msg = approveConfirmMessage(submission({ distribution_type: "git" }));
    expect(msg).not.toMatch(/Docker image/);
  });
});

describe("archiveConfirmMessage", () => {
  it("says archiving delists the plugin and is final", () => {
    const msg = archiveConfirmMessage(submission());
    expect(msg).toContain('"Weather Plus" (weather-plus)');
    expect(msg).toMatch(/removes .* from the catalog/);
    expect(msg).toMatch(/final status/);
  });
});

describe("parseServerTimestamp", () => {
  it("reads an offset-less (naive UTC) timestamp as UTC", () => {
    expect(parseServerTimestamp("2026-10-01T12:30:00")?.toISOString()).toBe(
      "2026-10-01T12:30:00.000Z",
    );
    expect(parseServerTimestamp("2026-10-01T12:30:00.123456")?.toISOString()).toBe(
      "2026-10-01T12:30:00.123Z",
    );
  });

  it("respects an explicit offset", () => {
    expect(parseServerTimestamp("2026-10-01T12:30:00Z")?.toISOString()).toBe(
      "2026-10-01T12:30:00.000Z",
    );
    expect(parseServerTimestamp("2026-10-01T14:30:00+02:00")?.toISOString()).toBe(
      "2026-10-01T12:30:00.000Z",
    );
  });

  it("returns null for missing or unparseable values", () => {
    expect(parseServerTimestamp(null)).toBeNull();
    expect(parseServerTimestamp(undefined)).toBeNull();
    expect(parseServerTimestamp("")).toBeNull();
    expect(parseServerTimestamp("yesterday")).toBeNull();
  });
});
