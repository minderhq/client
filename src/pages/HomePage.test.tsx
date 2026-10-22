import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HomePage } from "./HomePage";

const apiFetch = vi.fn();

vi.mock("react-router-dom", () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

// HealthStrip self-fetches /v1/status; stub it so it doesn't add its own
// entries to the apiFetch mock queue these tests assert against (it has its
// own dedicated test coverage).
vi.mock("../components/HealthStrip", () => ({
  HealthStrip: () => null,
}));

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => apiFetch(...args),
  };
});

// orgRole: what the "Connect a model" card is gated on (useCan).
let mockAuth: { isAuthenticated: boolean; username: string; token: string; orgRole?: string } = {
  isAuthenticated: false,
  username: "",
  token: "",
};
vi.mock("../lib/auth", () => ({
  useAuth: () => mockAuth,
}));

function kb(overrides: { document_count?: number; vector_count?: number } = {}) {
  return { document_count: 1, vector_count: 10, ...overrides };
}

function routeApiFetch(opts: {
  kbs?: ReturnType<typeof kb>[];
  pipelineCount?: number;
  bundles?: { enabled: number; total: number };
  modelCount?: number;
  modelReady?: boolean;
}) {
  const {
    kbs = [],
    pipelineCount = 0,
    bundles = { enabled: 0, total: 0 },
    modelCount = 0,
    modelReady = true,
  } = opts;
  apiFetch.mockImplementation((path: string) => {
    if (path.startsWith("/v1/rag/knowledge-bases"))
      return Promise.resolve({ items: kbs, total: kbs.length });
    if (path.startsWith("/v1/rag/pipeline"))
      return Promise.resolve({ items: [], total: pipelineCount });
    if (path === "/v1/bundles")
      return Promise.resolve({
        bundles: Array.from({ length: bundles.enabled }, (_, i) => ({
          name: `b${i}`,
          core: false,
          enabled: true,
          claims: [],
          services: [],
        })),
        orphaned: [],
        count: bundles.total,
      });
    if (path === "/v1/readiness") {
      const ok = { ready: true, reason: null };
      const model = modelReady ? ok : { ready: false, reason: "no_model" };
      return Promise.resolve({
        ready: modelReady,
        checks: { model, pipeline: ok, knowledge_base: ok, email: ok },
      });
    }
    if (path.startsWith("/v1/models"))
      return Promise.resolve({ items: [], total: modelCount });
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
}

describe("HomePage", () => {
  afterEach(() => {
    cleanup();
    apiFetch.mockReset();
    mockAuth = { isAuthenticated: false, username: "", token: "" };
  });

  it("greets an anonymous visitor and still loads stats (browsing is open to everyone)", async () => {
    routeApiFetch({});
    render(<HomePage />);

    expect(screen.getByText("Minder")).toBeTruthy();
    expect(
      screen.getByText("Browsing is open for everyone — log in on any page to make changes."),
    ).toBeTruthy();
    await screen.findByText("Create your first knowledge base");
  });

  it("shows an org owner the Connect a model step when no model is available", async () => {
    mockAuth = { isAuthenticated: true, username: "alice", token: "tok", orgRole: "owner" };
    routeApiFetch({ modelReady: false });
    render(<HomePage />);

    await screen.findByRole("heading", { name: "Connect a model" });
    expect(screen.getByRole("link", { name: /Open Providers & defaults/ }).getAttribute("href")).toBe(
      "/platform/providers",
    );
  });

  it("asks a member to contact an administrator when no model is available", async () => {
    mockAuth = { isAuthenticated: true, username: "bob", token: "tok", orgRole: "member" };
    routeApiFetch({ modelReady: false });
    render(<HomePage />);

    await screen.findByText(/Ask an administrator to connect a model/);
    expect(screen.queryByRole("heading", { name: "Connect a model" })).toBeNull();
  });

  it("adds nothing when the model check passes", async () => {
    mockAuth = { isAuthenticated: true, username: "alice", token: "tok", orgRole: "owner" };
    routeApiFetch({ modelReady: true });
    render(<HomePage />);

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/v1/readiness", expect.anything()));
    await screen.findByText("Create your first knowledge base");
    expect(screen.queryByText("Connect a model")).toBeNull();
    expect(screen.queryByText(/Ask an administrator/)).toBeNull();
  });

  it("greets a logged-in user by name", async () => {
    mockAuth = { isAuthenticated: true, username: "alice", token: "tok" };
    routeApiFetch({});
    render(<HomePage />);

    expect(screen.getByText("Welcome back, alice")).toBeTruthy();
    expect(screen.getByText("Here's what's running right now.")).toBeTruthy();
  });

  it("suggests creating a KB when there are none yet", async () => {
    routeApiFetch({ kbs: [] });
    render(<HomePage />);

    await screen.findByText("Create your first knowledge base");
    expect(
      screen.getByText(/Upload a document \(PDF\/TXT\/MD\) to start/),
    ).toBeTruthy();
  });

  it("suggests uploading once a KB exists but has no ingested vectors yet", async () => {
    routeApiFetch({ kbs: [kb({ document_count: 0, vector_count: 0 })] });
    render(<HomePage />);

    await screen.findByText("Upload a document");
  });

  it("suggests building a pipeline once a KB is ready but no pipeline exists", async () => {
    routeApiFetch({ kbs: [kb(), kb()], pipelineCount: 0 });
    render(<HomePage />);

    await screen.findByText("Build a pipeline");
    expect(screen.getByText(/You have 2 knowledge bases ready/)).toBeTruthy();
  });

  it("suggests asking a question once a pipeline exists", async () => {
    routeApiFetch({ kbs: [kb()], pipelineCount: 1 });
    render(<HomePage />);

    await screen.findByText("Jump into Ask to query your 1 pipeline", { exact: false });
  });

  it("renders the live stat counts once loaded", async () => {
    routeApiFetch({
      kbs: [kb(), kb({ document_count: 0, vector_count: 0 })],
      pipelineCount: 3,
      bundles: { enabled: 2, total: 5 },
      modelCount: 4,
    });
    render(<HomePage />);

    await screen.findByText("2"); // Knowledge Bases count (kbCount, not readyKbCount)
    expect(screen.getByText("3")).toBeTruthy(); // Pipelines
    expect(screen.getByText("2/5")).toBeTruthy(); // Service bundles enabled
    expect(screen.getByText("4")).toBeTruthy(); // Models
  });

  it("renders quick actions and the explore section", () => {
    routeApiFetch({});
    render(<HomePage />);

    expect(screen.getByText("Quick actions")).toBeTruthy();
    expect(screen.getByRole("link", { name: /New knowledge base/ })).toBeTruthy();
    expect(screen.getByText("More to explore")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Knowledge Graph/ })).toBeTruthy();
  });

  it("links the marketplace shortcuts and the service bundles tile to the new routes (#2197)", () => {
    routeApiFetch({});
    render(<HomePage />);

    const href = (name: RegExp) => screen.getByRole("link", { name }).getAttribute("href");
    expect(href(/^Discover plugins$/)).toBe("/marketplace/discover/plugins");
    expect(href(/^Discover AI tools$/)).toBe("/marketplace/discover/ai-tools");
    expect(href(/^Discover service bundles$/)).toBe("/marketplace/discover/service-bundles");
    expect(href(/Service bundles enabled/i)).toBe("/marketplace/installed/service-bundles");
    // No link on Home still points at a pre-#2197 marketplace URL.
    for (const a of screen.getAllByRole("link")) {
      expect(a.getAttribute("href")).not.toMatch(/^\/(plugins|ai-tools|bundles)(\/|$)/);
    }
  });

  it("warns that OpenWebUI's own Knowledge feature is disconnected from Minder's RAG pipeline", () => {
    routeApiFetch({});
    render(<HomePage />);

    expect(
      screen.getByText(/has no access to Minder's actual RAG pipeline/),
    ).toBeTruthy();
  });
});
