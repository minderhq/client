import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PublicChatEndpointsPage,
  type PipelineOption,
  type PublicChatEndpoint,
} from "./PublicChatEndpointsPage";

// The endpoint rows now link into the conversation dashboard (#1582), so the
// page needs a Router context to render.
function renderPage() {
  return render(
    <MemoryRouter>
      <PublicChatEndpointsPage />
    </MemoryRouter>,
  );
}

const apiFetch = vi.fn();
vi.mock("../lib/api", () => ({
  apiBaseUrl: "http://gateway.test",
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  friendlyErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
}));

let mockAuth = {
  token: "",
  role: "",
  orgRole: "",
  isPlatformAdmin: false,
};
vi.mock("../lib/auth", () => ({
  useAuth: () => mockAuth,
}));

const mockConfirm = vi.fn();
vi.mock("../components/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: mockConfirm, dialog: null }),
}));

// copyText/useAutoClearTimeout hit navigator.clipboard / timers we don't care
// about here — stub them so the copy affordance renders without side effects.
vi.mock("../lib/browser", () => ({
  copyText: vi.fn().mockResolvedValue(true),
  useAutoClearTimeout: () => () => {},
}));

const ADMIN = {
  token: "tok",
  role: "member",
  orgRole: "admin",
  isPlatformAdmin: false,
};

function endpoint(
  overrides: Partial<PublicChatEndpoint> = {},
): PublicChatEndpoint {
  return {
    id: 1,
    tenant_id: "t1",
    name: "Support Bot",
    slug: "support",
    pipeline_id: "pipe-1",
    rag_config: {},
    enabled: true,
    rate_limit_per_minute: 20,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const PIPELINES: PipelineOption[] = [
  { id: "pipe-1", name: "Docs pipeline" },
  { id: "pipe-2", name: "FAQ pipeline" },
];

/** Route apiFetch by path + method so the two on-mount GETs (endpoints +
 * pipelines) and any later mutation resolve independently of call order. */
function installApi(
  opts: {
    endpoints?: PublicChatEndpoint[];
    pipelines?: PipelineOption[];
    endpointsError?: Error;
    created?: PublicChatEndpoint;
  } = {},
) {
  const {
    endpoints = [],
    pipelines = PIPELINES,
    endpointsError,
    created = endpoint(),
  } = opts;
  apiFetch.mockImplementation(
    (path: string, options: { method?: string } = {}) => {
      const method = options.method ?? "GET";
      if (path.startsWith("/v1/public-chat/endpoints") && method === "GET") {
        return endpointsError
          ? Promise.reject(endpointsError)
          : Promise.resolve({
              items: endpoints,
              total: endpoints.length,
              limit: 100,
              offset: 0,
            });
      }
      if (path.startsWith("/v1/rag/pipeline") && method === "GET") {
        return Promise.resolve({
          items: pipelines,
          total: pipelines.length,
          limit: 100,
          offset: 0,
        });
      }
      if (path === "/v1/public-chat/endpoints" && method === "POST") {
        return Promise.resolve(created);
      }
      if (method === "PATCH") return Promise.resolve({});
      if (method === "DELETE") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    },
  );
}

describe("PublicChatEndpointsPage", () => {
  afterEach(() => {
    cleanup();
    apiFetch.mockReset();
    mockConfirm.mockReset();
  });

  it("shows an admin-required message and never fetches for a non-admin", () => {
    mockAuth = { token: "tok", role: "member", orgRole: "member", isPlatformAdmin: false };
    renderPage();
    expect(
      screen.getByText("Admin role required to manage public chat endpoints."),
    ).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("prompts to log in when unauthenticated", () => {
    mockAuth = { token: "", role: "", orgRole: "", isPlatformAdmin: false };
    renderPage();
    expect(
      screen.getByText("Log in as an admin to manage public chat endpoints."),
    ).toBeTruthy();
  });

  it("lists endpoints for an admin, with pipeline name and public URL", async () => {
    mockAuth = ADMIN;
    installApi({
      endpoints: [
        endpoint({ name: "Support Bot", slug: "support" }),
        endpoint({ id: 2, name: "Sales Bot", slug: "sales", enabled: false }),
      ],
    });
    renderPage();

    expect(await screen.findByText("Support Bot")).toBeTruthy();
    expect(screen.getByText("Sales Bot")).toBeTruthy();
    expect(screen.getByText("disabled")).toBeTruthy();
    // Pipeline id resolves to its human name from the pipelines fetch.
    expect(screen.getAllByText("Docs pipeline").length).toBeGreaterThan(0);
    // Public URL is derived from the configured gateway base + slug.
    expect(
      screen.getByText("http://gateway.test/public/chat/support"),
    ).toBeTruthy();
  });

  it("shows an empty state when there are no endpoints", async () => {
    mockAuth = ADMIN;
    installApi({ endpoints: [] });
    renderPage();
    expect(
      await screen.findByText("No public chat endpoints yet."),
    ).toBeTruthy();
  });

  it("prompts to create a pipeline first when none exist", async () => {
    mockAuth = ADMIN;
    installApi({ endpoints: [], pipelines: [] });
    renderPage();
    expect(
      await screen.findByText(
        "Create a RAG pipeline first — a public chat endpoint needs one to answer from.",
      ),
    ).toBeTruthy();
  });

  it("creates an endpoint from the form", async () => {
    mockAuth = ADMIN;
    installApi({ endpoints: [] });
    renderPage();
    await screen.findByText("No public chat endpoints yet.");

    fireEvent.click(screen.getByText("New Endpoint"));

    fireEvent.change(await screen.findByPlaceholderText("e.g. Support Bot"), {
      target: { value: "Support Bot" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. support"), {
      target: { value: "support" },
    });
    // Pipeline select is the first combobox in the create form.
    fireEvent.change(screen.getAllByRole("combobox")[0], {
      target: { value: "pipe-2" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/public-chat/endpoints", {
        method: "POST",
        token: "tok",
        body: {
          name: "Support Bot",
          slug: "support",
          pipeline_id: "pipe-2",
          rate_limit_per_minute: 20,
          rag_config: {},
        },
      }),
    );
  });

  it("stores the chosen RAG method in rag_config on create", async () => {
    mockAuth = ADMIN;
    installApi({ endpoints: [] });
    renderPage();
    await screen.findByText("No public chat endpoints yet.");

    fireEvent.click(screen.getByText("New Endpoint"));
    fireEvent.change(await screen.findByPlaceholderText("e.g. Support Bot"), {
      target: { value: "Support Bot" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. support"), {
      target: { value: "support" },
    });
    // Pipeline select is the first combobox, RAG method select is the last.
    const combos = screen.getAllByRole("combobox");
    fireEvent.change(combos[0], { target: { value: "pipe-1" } });
    fireEvent.change(combos[combos.length - 1], { target: { value: "hyde" } });

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/public-chat/endpoints", {
        method: "POST",
        token: "tok",
        body: {
          name: "Support Bot",
          slug: "support",
          pipeline_id: "pipe-1",
          rate_limit_per_minute: 20,
          rag_config: { method: "hyde" },
        },
      }),
    );
  });

  it("edits an endpoint's name via PATCH", async () => {
    mockAuth = ADMIN;
    installApi({ endpoints: [endpoint()] });
    renderPage();
    await screen.findByText("Support Bot");

    fireEvent.click(screen.getByText("Edit"));
    const nameInput = await screen.findByLabelText("Endpoint name");
    fireEvent.change(nameInput, { target: { value: "Renamed Bot" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/public-chat/endpoints/1", {
        method: "PATCH",
        token: "tok",
        body: {
          name: "Renamed Bot",
          pipeline_id: "pipe-1",
          rate_limit_per_minute: 20,
          rag_config: {},
        },
      }),
    );
  });

  it("toggles an endpoint's enabled state", async () => {
    mockAuth = ADMIN;
    installApi({ endpoints: [endpoint({ enabled: true })] });
    renderPage();
    await screen.findByText("Support Bot");

    fireEvent.click(screen.getByText("Disable"));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/public-chat/endpoints/1", {
        method: "PATCH",
        token: "tok",
        body: { enabled: false },
      }),
    );
  });

  it("deletes an endpoint only after confirmation", async () => {
    mockAuth = ADMIN;
    installApi({ endpoints: [endpoint()] });
    renderPage();
    await screen.findByText("Support Bot");

    mockConfirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByText("Delete"));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1));
    expect(apiFetch).not.toHaveBeenCalledWith("/v1/public-chat/endpoints/1", {
      method: "DELETE",
      token: "tok",
    });

    mockConfirm.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByText("Delete"));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/public-chat/endpoints/1", {
        method: "DELETE",
        token: "tok",
      }),
    );
  });

  it("surfaces a fetch error via the status line", async () => {
    mockAuth = ADMIN;
    installApi({ endpointsError: new Error("gateway unreachable") });
    renderPage();
    expect(await screen.findByText("gateway unreachable")).toBeTruthy();
  });
});
