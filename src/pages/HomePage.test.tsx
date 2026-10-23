import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Onboarding } from "../lib/onboarding";
import type { Readiness, ReadinessCheck } from "../lib/readiness";
import { HomePage } from "./HomePage";

const apiFetch = vi.fn();

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

// HealthStrip has its own tests; here only who gets it matters.
vi.mock("../components/HealthStrip", () => ({
  HealthStrip: () => <div data-testid="health-strip" />,
}));
vi.mock("../lib/useBillingAccess", () => ({ useBillingAccess: () => false }));

interface MockAuth {
  isAuthenticated: boolean;
  username: string;
  token: string;
  sessionKey: string;
  role: string;
  orgRole: string;
  isPlatformAdmin: boolean;
  activeTenantId: string;
  tenantId: string;
}
const ANONYMOUS: MockAuth = {
  isAuthenticated: false,
  username: "",
  token: "",
  sessionKey: "",
  role: "",
  orgRole: "",
  isPlatformAdmin: false,
  activeTenantId: "",
  tenantId: "",
};
let mockAuth: MockAuth = ANONYMOUS;
vi.mock("../lib/auth", () => ({ useAuth: () => mockAuth }));

function signIn(persona: "member" | "orgAdmin" | "platformAdmin") {
  mockAuth = {
    ...ANONYMOUS,
    isAuthenticated: true,
    username: "alice",
    token: "tok",
    sessionKey: "s1",
    role: "user",
    orgRole: persona === "orgAdmin" ? "admin" : "member",
    isPlatformAdmin: persona === "platformAdmin",
    activeTenantId: "1",
    tenantId: "1",
  };
}

const OK: ReadinessCheck = { ready: true, reason: null };

function onboardingState(overrides: Partial<Onboarding> = {}): Onboarding {
  return {
    intended_use: null,
    team_mode: null,
    checklist: {},
    skipped: false,
    ask_intro: false,
    created_at: "2026-10-20T10:00:00+00:00",
    updated_at: "2026-10-20T10:00:00+00:00",
    ...overrides,
  };
}

interface Server {
  onboarding?: Onboarding;
  checks?: Partial<Readiness["checks"]>;
  readyKbs?: number;
  patchFails?: boolean;
}

/** Routes apiFetch like the gateway: PATCH /v1/onboarding merges the
 * checklist per step and stamps created_at, as the server does. */
function serve({ onboarding = onboardingState(), checks = {}, readyKbs = 0, patchFails }: Server) {
  let state = onboarding;
  apiFetch.mockImplementation((path: string, opts: { method?: string; body?: Partial<Onboarding> }) => {
    if (path === "/v1/onboarding") {
      if (opts?.method === "PATCH") {
        if (patchFails) return Promise.reject(new Error("boom"));
        const body = opts.body ?? {};
        state = {
          ...state,
          ...body,
          checklist: { ...state.checklist, ...(body.checklist ?? {}) },
          created_at: state.created_at ?? "2026-10-23T09:00:00+00:00",
        };
      }
      return Promise.resolve(state);
    }
    if (path === "/v1/readiness") {
      const all = { model: OK, pipeline: OK, knowledge_base: OK, email: OK, ...checks };
      return Promise.resolve({ ready: Object.values(all).every((c) => c.ready), checks: all });
    }
    if (path.startsWith("/v1/rag/knowledge-bases")) {
      const items = Array.from({ length: readyKbs }, () => ({ document_count: 1, vector_count: 5 }));
      return Promise.resolve({ items, total: items.length });
    }
    if (path.startsWith("/v1/rag/pipeline")) return Promise.resolve({ items: [], total: 0 });
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
}

function renderHome() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

async function checklist() {
  return screen.findByRole("region", { name: "Getting started" });
}

/** The checklist's step ids, in display order. */
async function stepIds() {
  const card = await checklist();
  return Array.from(card.querySelectorAll("li[data-step]")).map((li) => li.getAttribute("data-step"));
}

function patches() {
  return apiFetch.mock.calls.filter(([, o]) => o?.method === "PATCH").map(([, o]) => o.body);
}

afterEach(() => {
  cleanup();
  apiFetch.mockReset();
  mockAuth = ANONYMOUS;
});

describe("HomePage per persona", () => {
  it("shows an anonymous visitor the product, with no checklist and no onboarding reads", () => {
    serve({});
    renderHome();

    expect(screen.getByRole("heading", { level: 1, name: "Minder" })).toBeTruthy();
    expect(screen.getByText(/Browsing is open for everyone/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Getting started" })).toBeNull();
    expect(apiFetch).not.toHaveBeenCalledWith("/v1/onboarding", expect.anything());
    expect(screen.queryByTestId("health-strip")).toBeNull();
  });

  it("gives a member their own next steps: ask, use a knowledge base, profile", async () => {
    signIn("member");
    serve({ checks: { knowledge_base: { ready: false, reason: "no_knowledge_base" } } });
    renderHome();

    expect(await stepIds()).toEqual(["ask", "use_kb", "profile"]);
    expect(screen.queryByText("Connect a model")).toBeNull();
    expect(screen.queryByText("Invite your teammates")).toBeNull();
    expect(screen.queryByTestId("health-strip")).toBeNull();
    expect(screen.getByRole("link", { name: "Complete your profile" }).getAttribute("href")).toBe(
      "/settings",
    );
  });

  it("gives an org admin the setup checklist, without installation health", async () => {
    signIn("orgAdmin");
    serve({
      checks: {
        knowledge_base: { ready: false, reason: "no_knowledge_base" },
        pipeline: { ready: false, reason: "no_pipeline" },
      },
    });
    renderHome();

    expect(await stepIds()).toEqual([
      "model",
      "knowledge_base",
      "upload",
      "assistant",
      "ask",
      "invite",
    ]);
    expect(screen.queryByText("Set up email")).toBeNull();
    expect(screen.queryByTestId("health-strip")).toBeNull();
  });

  it("gives a Platform Admin the setup checklist plus email and installation health", async () => {
    signIn("platformAdmin");
    serve({ checks: { email: { ready: false, reason: "email_disabled" } } });
    renderHome();

    expect(await stepIds()).toEqual([
      "model",
      "knowledge_base",
      "upload",
      "assistant",
      "ask",
      "invite",
      "email",
    ]);
    expect(screen.getByTestId("health-strip")).toBeTruthy();
  });
});

describe("Getting started state", () => {
  it("marks steps done from readiness, the knowledge-base counts and the stored state", async () => {
    signIn("orgAdmin");
    serve({
      checks: { pipeline: { ready: false, reason: "no_pipeline" } },
      readyKbs: 1,
      onboarding: onboardingState({ checklist: { ask: "done" } }),
    });
    renderHome();

    const card = await checklist();
    const status = (id: string) => card.querySelector(`li[data-step="${id}"] .sr-only`)?.textContent;
    await waitFor(() => expect(status("upload")).toContain("(Done)"));
    expect(status("model")).toContain("(Done)");
    expect(status("knowledge_base")).toContain("(Done)");
    expect(status("ask")).toContain("(Done)");
    expect(status("assistant")).toContain("(Not done yet)");
    expect(status("invite")).toContain("(Not done yet)");
    expect(within(card).getByText("4 of 6 done")).toBeTruthy();
    // A step the server can see has no manual tick; one it can't, has.
    expect(within(card).queryByRole("button", { name: "Mark as done: Set up an assistant" })).toBeNull();
    expect(within(card).getByRole("button", { name: "Mark as done: Invite your teammates" })).toBeTruthy();
  });

  it("hides a step skipped earlier", async () => {
    signIn("orgAdmin");
    serve({ onboarding: onboardingState({ checklist: { invite: "dismissed" } }), readyKbs: 0 });
    renderHome();

    expect(await stepIds()).not.toContain("invite");
  });

  it("stores a skipped step with PATCH and removes it", async () => {
    signIn("orgAdmin");
    serve({ checks: { pipeline: { ready: false, reason: "no_pipeline" } } });
    renderHome();

    const card = await checklist();
    fireEvent.click(within(card).getByRole("button", { name: "Skip: Invite your teammates" }));

    await waitFor(() => expect(within(card).queryByText("Invite your teammates")).toBeNull());
    expect(patches()).toContainEqual({ checklist: { invite: "dismissed" } });
  });

  it("stores a step marked done with PATCH and shows it done", async () => {
    signIn("member");
    serve({});
    renderHome();

    const card = await checklist();
    fireEvent.click(within(card).getByRole("button", { name: "Mark as done: Complete your profile" }));

    await waitFor(() =>
      expect(card.querySelector('li[data-step="profile"] .sr-only')?.textContent).toContain("(Done)"),
    );
    expect(patches()).toContainEqual({ checklist: { profile: "done" } });
  });

  it("hides the whole card with PATCH", async () => {
    signIn("member");
    serve({});
    renderHome();

    fireEvent.click(within(await checklist()).getByRole("button", { name: "Hide Getting started" }));

    await waitFor(() => expect(screen.queryByRole("region", { name: "Getting started" })).toBeNull());
    expect(patches()).toContainEqual({ checklist: { getting_started: "dismissed" } });
  });

  it("stays hidden once hidden, and disappears when every step is done", async () => {
    signIn("member");
    serve({ onboarding: onboardingState({ checklist: { ask: "done", profile: "done" } }) });
    renderHome();

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/v1/readiness", expect.anything()));
    await screen.findByText("Welcome back, alice");
    expect(screen.queryByRole("region", { name: "Getting started" })).toBeNull();
  });

  it("says so when a change can't be saved", async () => {
    signIn("member");
    serve({ patchFails: true });
    renderHome();

    fireEvent.click(within(await checklist()).getByRole("button", { name: "Skip: Complete your profile" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/Couldn't save that change/);
    expect(screen.getByText("Complete your profile")).toBeTruthy();
  });

  it("puts the intro answers' steps first, keeping the model step at the top", async () => {
    signIn("orgAdmin");
    serve({ onboarding: onboardingState({ intended_use: "team_knowledge", team_mode: "team" }) });
    renderHome();

    expect(await stepIds()).toEqual([
      "model",
      "knowledge_base",
      "invite",
      "upload",
      "assistant",
      "ask",
    ]);
  });

  it("explains a step the server can't check right now", async () => {
    signIn("member");
    serve({ checks: { knowledge_base: { ready: false, reason: "rag_service_unavailable" } } });
    renderHome();

    expect(await within(await checklist()).findByText(/the service isn't answering/)).toBeTruthy();
  });
});

describe("first visit vs returning", () => {
  it("welcomes a first visit and records it", async () => {
    signIn("member");
    serve({ onboarding: onboardingState({ created_at: null, updated_at: null }) });
    renderHome();

    expect(await screen.findByRole("heading", { level: 1, name: "Welcome to Minder, alice" })).toBeTruthy();
    expect(screen.getByText(/A few short steps below/)).toBeTruthy();
    await waitFor(() => expect(patches()).toContainEqual({ checklist: {} }));
    // Recording the visit doesn't flip the greeting mid-visit.
    expect(screen.getByRole("heading", { level: 1, name: "Welcome to Minder, alice" })).toBeTruthy();
  });

  it("welcomes a returning user back without writing anything", async () => {
    signIn("member");
    serve({});
    renderHome();

    expect(await screen.findByRole("heading", { level: 1, name: "Welcome back, alice" })).toBeTruthy();
    expect(screen.queryByText(/Welcome to Minder/)).toBeNull();
    await checklist();
    expect(patches()).toEqual([]);
  });

  it("uses a neutral greeting while the onboarding state can't be read", async () => {
    signIn("member");
    serve({});
    const route = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path: string, opts: unknown) =>
      path === "/v1/onboarding" ? Promise.reject(new Error("404")) : route(path, opts),
    );
    renderHome();

    expect(await screen.findByRole("heading", { level: 1, name: "Hello, alice" })).toBeTruthy();
    expect(screen.queryByText(/Welcome back/)).toBeNull();
  });
});

describe("model not connected", () => {
  const noModel = { model: { ready: false, reason: "no_model" } };

  it("puts Connect a model at the top of an admin's checklist, with the providers page and the docs", async () => {
    signIn("orgAdmin");
    serve({ checks: noModel });
    renderHome();

    const card = await checklist();
    expect((await stepIds())[0]).toBe("model");
    expect(within(card).getByRole("link", { name: "Connect a model" }).getAttribute("href")).toBe(
      "/platform/providers",
    );
    expect(within(card).getByText(/No language model is available yet/)).toBeTruthy();
    expect(within(card).getByRole("link", { name: /How to connect your models/ })).toBeTruthy();
    // Not a second, parallel widget.
    expect(screen.getAllByText(/No language model is available yet/)).toHaveLength(1);
  });

  it("tells an admin the model service is down when that is the reason", async () => {
    signIn("orgAdmin");
    serve({ checks: { model: { ready: false, reason: "model_service_unavailable" } } });
    renderHome();

    expect(await within(await checklist()).findByText(/The model service isn't answering/)).toBeTruthy();
  });

  it("asks a member to contact an administrator", async () => {
    signIn("member");
    serve({ checks: noModel });
    renderHome();

    expect(await screen.findByText(/Ask an administrator to connect a model/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Connect a model" })).toBeNull();
  });

  it("still warns an admin who has hidden the checklist", async () => {
    signIn("orgAdmin");
    serve({ checks: noModel, onboarding: onboardingState({ checklist: { getting_started: "dismissed" } }) });
    renderHome();

    expect(await screen.findByText(/No language model is available yet/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Providers & defaults" }).getAttribute("href")).toBe(
      "/platform/providers",
    );
    expect(screen.queryByRole("region", { name: "Getting started" })).toBeNull();
  });

  it("adds no notice while the model check passes", async () => {
    signIn("member");
    serve({});
    renderHome();

    await checklist();
    expect(screen.queryByText(/Ask an administrator/)).toBeNull();
  });
});
