import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BillingPage, PlanCard } from "./BillingPage";
import type { Subscription } from "../lib/billing";
import { redirectTo } from "../lib/redirect";

const apiFetch = vi.fn();

vi.mock("../lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  friendlyErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
}));

let mockAuth = { token: "", role: "" };
vi.mock("../lib/auth", () => ({
  useAuth: () => mockAuth,
}));

vi.mock("../lib/redirect", () => ({ redirectTo: vi.fn() }));

function sub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    tenant_id: "org-1",
    tier: "community",
    baseline: true,
    status: null,
    valid_until: null,
    provider: null,
    manageable: false,
    ...overrides,
  };
}

beforeEach(() => {
  mockAuth = { token: "t", role: "user" };
  apiFetch.mockReset();
  vi.mocked(redirectTo).mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PlanCard", () => {
  it("shows a free-plan badge for the baseline tier", () => {
    render(<PlanCard sub={sub()} />);
    expect(screen.getByText("Community")).toBeTruthy();
    expect(screen.getByText("free plan")).toBeTruthy();
  });

  it("shows the status + renewal for a paid plan", () => {
    render(
      <PlanCard
        sub={sub({
          tier: "pro",
          baseline: false,
          status: "active",
          valid_until: "2027-01-01T00:00:00Z",
          provider: "lemonsqueezy",
        })}
      />,
    );
    expect(screen.getByText("Pro")).toBeTruthy();
    expect(screen.getByText("active")).toBeTruthy();
    expect(screen.getByText("2027-01-01")).toBeTruthy();
  });
});

describe("BillingPage", () => {
  it("renders the current plan and upgrade options", async () => {
    apiFetch.mockResolvedValueOnce(sub()); // subscription
    render(<BillingPage />);
    expect(await screen.findByText("Community")).toBeTruthy();
    // baseline plan → both paid tiers offered, no Manage button
    expect(screen.getByText("Upgrade to Pro")).toBeTruthy();
    expect(screen.getByText("Upgrade to Enterprise")).toBeTruthy();
    expect(screen.queryByText("Manage subscription")).toBeNull();
  });

  it("starts checkout for the chosen tier", async () => {
    apiFetch
      .mockResolvedValueOnce(sub()) // subscription
      .mockResolvedValueOnce({ checkout_url: "https://checkout.example", tier: "pro" });
    render(<BillingPage />);
    fireEvent.click(await screen.findByText("Upgrade to Pro"));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/v1/billing/checkout",
        expect.objectContaining({ method: "POST", body: { tier: "pro" } }),
      ),
    );
    expect(redirectTo).toHaveBeenCalledWith("https://checkout.example");
  });

  it("offers a Manage button that opens the portal for a manageable plan", async () => {
    apiFetch
      .mockResolvedValueOnce(
        sub({
          tier: "pro",
          baseline: false,
          status: "active",
          manageable: true,
          provider: "lemonsqueezy",
        }),
      )
      .mockResolvedValueOnce({ portal_url: "https://portal.example" });
    render(<BillingPage />);
    fireEvent.click(await screen.findByText("Manage subscription"));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/v1/billing/portal",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(redirectTo).toHaveBeenCalledWith("https://portal.example");
    // the current tier is not offered as its own upgrade
    expect(screen.queryByText("Upgrade to Pro")).toBeNull();
  });

  it("surfaces a checkout error instead of redirecting", async () => {
    apiFetch
      .mockResolvedValueOnce(sub())
      .mockRejectedValueOnce(new Error("Billing is not configured"));
    render(<BillingPage />);
    fireEvent.click(await screen.findByText("Upgrade to Pro"));
    expect(await screen.findByText("Billing is not configured")).toBeTruthy();
    expect(redirectTo).not.toHaveBeenCalled();
  });
});
