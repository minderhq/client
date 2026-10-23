import { afterEach, describe, expect, it, vi } from "vitest";

import { BULK_INVITE_MAX, bulkInvite, parseEmailList, roleImpact, type OrgRole } from "./people";

const apiFetch = vi.fn();
vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

afterEach(() => apiFetch.mockReset());

describe("parseEmailList", () => {
  it("splits on commas, semicolons and whitespace, de-duplicates and keeps the invalid ones", () => {
    expect(
      parseEmailList('a@x.com, B@x.com;"c@x.com"\n<d@x.com>  a@x.com\nnot-an-email\n\nb@X.com'),
    ).toEqual({ emails: ["a@x.com", "b@x.com", "c@x.com", "d@x.com"], invalid: ["not-an-email"] });
  });

  it("reads a one-column CSV with a header", () => {
    expect(parseEmailList("email\r\nann@x.org\r\nbo@x.org\r\n")).toEqual({
      emails: ["ann@x.org", "bo@x.org"],
      invalid: ["email"],
    });
  });

  it("returns nothing for blank input", () => {
    expect(parseEmailList("  \n ")).toEqual({ emails: [], invalid: [] });
  });
});

describe("roleImpact", () => {
  const roles = [
    { id: 1, name: "member", is_system: true, scope: "organization", permissions: ["org.members.view"] },
    { id: 2, name: "admin", is_system: true, scope: "organization", permissions: ["org.members.view", "org.members.manage"] },
  ] as OrgRole[];

  it("lists what a promotion adds and a demotion takes away", () => {
    expect(roleImpact(roles, "member", "admin")).toEqual({ gains: ["org.members.manage"], loses: [] });
    expect(roleImpact(roles, "admin", "member")).toEqual({ gains: [], loses: ["org.members.manage"] });
  });

  it("is null when a role isn't known", () => {
    expect(roleImpact(roles, "member", "owner")).toBeNull();
  });
});

describe("bulkInvite", () => {
  it(`sends at most ${BULK_INVITE_MAX} addresses per request and joins the outcomes in order`, async () => {
    apiFetch.mockImplementation((_path: string, init: { body: { emails: string[] } }) =>
      Promise.resolve({
        results: init.body.emails.map((email) => ({ email, status: "created" })),
        created_count: init.body.emails.length,
        failed_count: 0,
      }),
    );
    const emails = Array.from({ length: BULK_INVITE_MAX + 5 }, (_, i) => `p${i}@x.com`);
    const results = await bulkInvite(1, emails, "member", "tok");
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(apiFetch.mock.calls[0][0]).toBe("/v1/organizations/1/invites/bulk");
    expect(apiFetch.mock.calls[1][1].body).toEqual({ emails: emails.slice(BULK_INVITE_MAX), org_role: "member" });
    expect(results.map((r) => r.email)).toEqual(emails);
  });
});
