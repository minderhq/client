/**
 * Render the real app shell (App: AuthProvider, Sidebar, PageTabs, the
 * WorkspaceGate and the full <Routes> table) at a path, signed in as a
 * persona (client#126).
 *
 * The API is faked at the `fetch` boundary rather than by mocking lib/api, so
 * the real apiFetch / ApiError / useBillingAccess paths run: the persona's
 * billing visibility comes out of a real 200-or-403 on
 * GET /v1/billing/subscription, exactly as in production. Every other request
 * gets the same "safe empty" body App.test.tsx uses, which every page renders
 * as a normal empty state.
 *
 * Call `resetApp()` in afterEach.
 */
import { act, cleanup, render, waitFor, type RenderResult } from "@testing-library/react";
import { MemoryRouter, type Location } from "react-router-dom";
import { vi } from "vitest";

import { App } from "../App";
import { storeToken } from "../lib/api";
import { resetBillingAccessCache } from "../lib/useBillingAccess";
import { LocationProbe } from "./LocationProbe";
import { BASELINE_TIER, type Persona, personaToken } from "./personas";

/** Every array/count key a mounted page's fetch destructures, all empty: the
 * stub App.test.tsx uses, plus the keys of pages it only renders before their
 * data arrives (Backups, All users, a team's invites), since these tests
 * wait for it. */
export const SAFE_EMPTY_RESPONSE = {
  items: [],
  total: 0,
  limit: 20,
  offset: 0,
  count: 0,
  plugins: [],
  installations: [],
  dependencies: [],
  conflicts: [],
  recommendations: [],
  services: [],
  bundles: [],
  tools: [],
  repositories: [],
  organizations: [],
  licenses: [],
  archives: [],
  jobs: [],
  users: [],
  invites: [],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The fake gateway's answer for one request, as the persona would get it. */
export function personaResponse(persona: Persona, url: string): Response {
  const path = new URL(url, "http://localhost").pathname.replace(/^.*?(\/v1\/)/, "$1");
  const claims = persona.claims;

  if (path === "/v1/billing/subscription") {
    if (!persona.billing.view) return json({ detail: "Forbidden" }, 403);
    return json({
      tenant_id: claims?.active_tenant_id ?? "",
      tier: persona.tier,
      baseline: persona.tier === BASELINE_TIER,
      status: persona.tier === BASELINE_TIER ? null : "active",
      valid_until: null,
      provider: null,
      manageable: false,
      can_manage: persona.billing.canManage,
    });
  }
  if (path === "/v1/profile/me" && claims) {
    return json({
      username: claims.username,
      email: claims.email,
      workspace_state: "ready",
      can_create_workspace: false,
      email_verified: true,
      email_verification_required: false,
    });
  }
  if (path === "/v1/organizations/mine" && claims?.active_tenant_id) {
    return json({
      organizations: [
        {
          id: Number(claims.active_tenant_id),
          name: "Acme",
          slug: "acme",
          org_role: claims.org_role ?? "member",
          is_home: true,
        },
      ],
      active_organization_id: Number(claims.active_tenant_id),
    });
  }
  if (path === "/v1/teams") {
    return json({
      teams: persona.teams.map((t) => ({
        id: t.id,
        name: t.name,
        description: null,
        created_by: null,
        created_at: null,
        member_count: 1,
      })),
      total: persona.teams.length,
      limit: 20,
      offset: 0,
    });
  }
  const teamDetail = /^\/v1\/teams\/(\d+)$/.exec(path);
  if (teamDetail && claims) {
    const team = persona.teams.find((t) => t.id === Number(teamDetail[1]));
    if (!team) return json({ detail: "Not found" }, 404);
    return json({
      id: team.id,
      name: team.name,
      description: null,
      created_by: null,
      created_at: null,
      members: [
        {
          user_id: Number(claims.sub),
          username: claims.username,
          email: claims.email,
          team_role: team.team_role,
          joined_at: null,
        },
      ],
    });
  }
  return json(SAFE_EMPTY_RESPONSE);
}

/** The router's current location, captured next to <App/>. */
let currentLocation: Location | null = null;
function recordLocation(location: Location): void {
  currentLocation = location;
}

/** Where the router is now (after any redirect the render triggered). */
export function appLocation(): Location | null {
  return currentLocation;
}

/** Requests the current render's fake API has received but not yet answered.
 * A fresh object per renderApp, so a late answer to an earlier test's request
 * can't skew this test's count. */
let traffic = { inFlight: 0 };

/** Wait until the app is quiet: no fake request outstanding, and still none
 * after React has applied the responses (a response can trigger another
 * request). Use it before asserting that something is NOT shown, so a lock
 * callout or tab strip that appears only after a fetch would be caught. */
export async function settleApp(timeoutMs = 5_000): Promise<void> {
  for (let round = 0; round < 20; round++) {
    await waitFor(() => {
      if (traffic.inFlight !== 0) throw new Error(`${traffic.inFlight} request(s) still in flight`);
    }, { timeout: timeoutMs });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    if (traffic.inFlight === 0) return;
  }
  throw new Error("the app kept sending requests; it never settled");
}

export interface RenderAppResult extends RenderResult {
  persona: Persona;
  /** The fake fetch, for asserting which endpoints a persona hit. */
  fetchMock: ReturnType<typeof vi.fn>;
}

/** Render the whole app at `path` as `persona`. */
export function renderApp(persona: Persona, path = "/"): RenderAppResult {
  resetBillingAccessCache();
  sessionStorage.clear();
  const token = personaToken(persona);
  if (token) storeToken(token);

  const counter = { inFlight: 0 };
  traffic = counter;
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    counter.inFlight++;
    // Answer on a later macrotask, like a real network, and count it done
    // only once the caller has had the response.
    return new Promise<Response>((resolve) =>
      setTimeout(() => {
        resolve(personaResponse(persona, url));
        setTimeout(() => counter.inFlight--, 0);
      }, 0),
    );
  });
  vi.stubGlobal("fetch", fetchMock);

  const result = render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <LocationProbe onLocation={recordLocation} />
    </MemoryRouter>,
  );
  return { ...result, persona, fetchMock };
}

/** Undo renderApp: unmount, forget the session and restore fetch. */
export function resetApp(): void {
  cleanup();
  sessionStorage.clear();
  resetBillingAccessCache();
  vi.unstubAllGlobals();
  currentLocation = null;
  traffic = { inFlight: 0 };
}
