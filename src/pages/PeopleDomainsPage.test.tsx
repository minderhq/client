import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import type { PolicyKnob } from "../lib/people";
import { PeopleDomainsPage } from "./PeopleDomainsPage";

const apiFetch = vi.fn();

vi.mock("react-router-dom", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    token: "tok",
    sessionKey: "s1",
    userId: "10",
    role: "user",
    activeTenantId: "1",
    tenantId: "1",
    orgRole: "admin",
    isPlatformAdmin: false,
  }),
}));

function knob(overrides: Partial<PolicyKnob> = {}): PolicyKnob {
  return {
    key: "allowed_email_domains",
    value: null,
    effective: null,
    default: null,
    available: true,
    source: "default",
    grandfathered: false,
    ...overrides,
  };
}

function routeApiFetch(k: PolicyKnob) {
  apiFetch.mockImplementation((path: string, init?: { method?: string; body?: unknown }) => {
    if (path === "/v1/organizations/1/policy")
      return Promise.resolve({ organization_id: 1, tier: "community", knobs: [k] });
    if (path === "/v1/organizations/1/limits") return Promise.reject(new ApiError("forbidden", 403));
    if (path.startsWith("/v1/access-requests") || path.startsWith("/v1/billing"))
      return Promise.resolve({ requests: [], total: 0 });
    return Promise.reject(new Error(`unexpected ${init?.method ?? "GET"} ${path}`));
  });
}

describe("PeopleDomainsPage", () => {
  afterEach(() => {
    cleanup();
    apiFetch.mockReset();
  });

  it("explains the feature and the plan that has it when the org's plan lacks it", async () => {
    routeApiFetch(knob({ available: false, locked_reason: "tier", available_on: "pro" }));
    render(<PeopleDomainsPage />);
    expect(await screen.findByText(/only addresses on these domains can be invited/)).toBeTruthy();
    // Self-hosted (the test build's default): requires a licence, no buy buttons.
    expect(screen.getByText("Requires a Pro licence.")).toBeTruthy();
    expect(screen.queryByLabelText("Allowed email domains")).toBeNull();
  });

  it("saves the allowed domains when the plan has it", async () => {
    routeApiFetch(knob({ value: ["acme.com"], effective: ["acme.com"], source: "organization" }));
    render(<PeopleDomainsPage />);
    const field = (await screen.findByLabelText("Allowed email domains")) as HTMLTextAreaElement;
    await vi.waitFor(() => expect(field.value).toBe("acme.com"));
    fireEvent.change(field, { target: { value: "acme.com\nacme.com.tr" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/organizations/1/policy", {
        method: "PATCH",
        body: { allowed_email_domains: ["acme.com", "acme.com.tr"] },
        token: "tok",
      }),
    );
    expect(await screen.findByText("Allowed domains saved.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Allow any domain" }));
    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/organizations/1/policy", {
        method: "PATCH",
        body: { allowed_email_domains: null },
        token: "tok",
      }),
    );
  });
});
