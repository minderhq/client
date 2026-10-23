import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Entitlement, OrgSeats } from "../lib/useEntitlement";
import { LimitNotice, SeatBanner } from "./LimitNotice";
import { PlanBadge } from "./PlanBadge";

let entitlement: Partial<Entitlement> = {};
vi.mock("../lib/useEntitlement", () => ({ useEntitlement: () => entitlement }));

// RequestButton's own deployment copy reads this too.
let mode = "saas";
vi.mock("../lib/billing", async () => ({
  ...(await vi.importActual<typeof import("../lib/billing")>("../lib/billing")),
  get deploymentMode() {
    return mode;
  },
}));

vi.mock("../lib/auth", () => ({ useAuth: () => ({ token: "tok", activeTenantId: "7", tenantId: "7" }) }));

function setup(deployment: Entitlement["deployment"], canManageBilling: boolean, extra: Partial<Entitlement> = {}) {
  mode = deployment;
  entitlement = { deployment, canManageBilling, ...extra };
}

function renderNotice() {
  return render(
    <MemoryRouter>
      <LimitNotice requires="pro">Domain auto-join</LimitNotice>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe("PlanBadge", () => {
  it("shows the plan name and says the whole thing to screen readers", () => {
    render(<PlanBadge tier="enterprise" />);
    const badge = screen.getByTitle("Available on the Enterprise plan");
    expect(badge.textContent).toContain("Enterprise");
    expect(screen.getByText("Available on the Enterprise plan").className).toContain("sr-only");
  });
});

describe("LimitNotice", () => {
  it("offers a SaaS billing owner Upgrade and the 14-day trial", () => {
    setup("saas", true);
    renderNotice();
    expect(screen.getByText("Included in the Pro plan.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Upgrade" }).getAttribute("href")).toBe("/billing");
    expect(screen.getByRole("button", { name: "Try Pro free for 14 days" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ask the billing owner" })).toBeNull();
  });

  it("gives an admin without billing rights 'Ask the billing owner' and nothing to buy", () => {
    setup("saas", false);
    renderNotice();
    expect(screen.getByRole("button", { name: "Ask the billing owner: Pro" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Upgrade" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Try Pro/ })).toBeNull();
  });

  it("on self-hosted says a licence is needed, with no buy buttons for the operator", () => {
    setup("self-hosted", true);
    renderNotice();
    expect(screen.getByText("Requires a Pro licence.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("on self-hosted still lets an org admin ask the installation's admins", () => {
    setup("self-hosted", false);
    renderNotice();
    expect(screen.getByRole("button", { name: "Ask for a licence: Pro" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Upgrade" })).toBeNull();
  });

  it("air-gapped: only 'Upload licence file', never a link outside", () => {
    setup("air-gapped", true);
    renderNotice();
    expect(screen.getByText("Requires a Pro licence.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upload licence file" })).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("SeatBanner", () => {
  const seats = (over: Partial<OrgSeats>): OrgSeats => ({
    organization_id: 7,
    used: 3,
    reserved: 0,
    max: 10,
    behaviour: "soft",
    state: "ok",
    ...over,
  });

  it("shows the plain count under the limit", () => {
    setup("saas", true, { tier: "free", seats: seats({}) });
    render(<SeatBanner />);
    expect(screen.getByText("3/10 Free seats in use")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("is the honest banner over the limit", () => {
    setup("self-hosted", true, { tier: "community", seats: seats({ used: 14, state: "over_limit" }) });
    render(<SeatBanner />, { wrapper: MemoryRouter });
    expect(screen.getByText("14/10 Community seats in use")).toBeTruthy();
    expect(screen.getByText("Requires a Pro licence.")).toBeTruthy();
  });

  it("says new members are blocked on a hard limit, and offers no upgrade past Enterprise", () => {
    setup("saas", true, { tier: "enterprise", seats: seats({ used: 10, behaviour: "hard", state: "at_limit" }) });
    render(<SeatBanner />, { wrapper: MemoryRouter });
    expect(screen.getByText(/New members can't join/)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders nothing without seats or with unlimited seats", () => {
    setup("saas", true, { tier: "pro", seats: null });
    const { container } = render(<SeatBanner />);
    expect(container.textContent).toBe("");
    cleanup();
    setup("saas", true, { tier: "pro", seats: seats({ max: null, state: "unlimited" }) });
    expect(render(<SeatBanner />).container.textContent).toBe("");
  });
});
