import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "../i18n";
import { copyText } from "../lib/browser";
import { myPermissions, SERVER_SESSION, serveMyPermissions } from "../test/myPermissions";
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

let mockAuth: Record<string, unknown> = {
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
  isAuthenticated: true,
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
    mockAuth = { isAuthenticated: true, token: "tok", role: "member", orgRole: "member", isPlatformAdmin: false };
    renderPage();
    expect(
      screen.getByText("Org Admin role required to manage website chatbots."),
    ).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("gives the legacy instance admin role no access by itself", () => {
    mockAuth = { isAuthenticated: true, token: "tok", role: "admin", orgRole: "member", isPlatformAdmin: false };
    renderPage();
    expect(screen.getByText("Org Admin role required to manage website chatbots.")).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("opens to a custom role holding org.chatbots.manage", async () => {
    mockAuth = { token: "tok", role: "user", orgRole: "Support agent", isPlatformAdmin: false, ...SERVER_SESSION };
    installApi({});
    serveMyPermissions(apiFetch, myPermissions({ orgKeys: ["org.chatbots.manage"] }));
    renderPage();
    await waitFor(() => expect(screen.queryByText("Org Admin role required to manage website chatbots.")).toBeNull());
  });

  it("gates an org admin whose role lacks org.chatbots.manage", async () => {
    mockAuth = { token: "tok", role: "user", orgRole: "admin", isPlatformAdmin: false, ...SERVER_SESSION };
    installApi({});
    serveMyPermissions(apiFetch, myPermissions({ orgRole: "admin", orgKeys: ["org.members.manage"] }));
    renderPage();
    expect(await screen.findByText("Org Admin role required to manage website chatbots.")).toBeTruthy();
  });

  it("opens to the Platform Admin", async () => {
    mockAuth = { isAuthenticated: true, token: "tok", role: "user", orgRole: "member", isPlatformAdmin: true };
    installApi({});
    renderPage();
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(screen.queryByText("Org Admin role required to manage website chatbots.")).toBeNull();
  });

  it("prompts to log in when unauthenticated", () => {
    mockAuth = { token: "", role: "", orgRole: "", isPlatformAdmin: false };
    renderPage();
    expect(
      screen.getByText("Log in as an admin to manage website chatbots."),
    ).toBeTruthy();
  });

  it("lists endpoints for an admin, with pipeline name and public URL", async () => {
    mockAuth = ADMIN;
    installApi({
      endpoints: [
        endpoint({ name: "Support Bot", slug: "support", shareable_link: true }),
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

  it("copies the embed code built from the gateway base", async () => {
    mockAuth = ADMIN;
    installApi({ endpoints: [endpoint({ slug: "support" })] });
    vi.mocked(copyText).mockClear();
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Copy embed code/ }));
    await waitFor(() =>
      expect(copyText).toHaveBeenCalledWith(
        '<script src="http://gateway.test/public/chat/widget.js" data-bot="support" async></script>',
      ),
    );
    expect(await screen.findByText("Embed code copied")).toBeTruthy();
  });

  it("previews via a preview token, opened absolute against the gateway base", async () => {
    mockAuth = ADMIN;
    installApi({ endpoints: [endpoint({ id: 7, slug: "support" })] });
    const tab = { opener: {}, location: { href: "" }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path: string, options: { method?: string } = {}) =>
      path === "/v1/public-chat/endpoints/7/preview-token"
        ? Promise.resolve({ token: "pt", expires_in: 600, url: "/public/chat/support?preview=pt" })
        : base(path, options),
    );
    try {
      renderPage();
      fireEvent.click(await screen.findByRole("button", { name: "Preview" }));
      await waitFor(() =>
        expect(tab.location.href).toBe("http://gateway.test/public/chat/support?preview=pt"),
      );
      expect(apiFetch).toHaveBeenCalledWith("/v1/public-chat/endpoints/7/preview-token", {
        method: "POST",
        token: "tok",
      });
      expect(open).toHaveBeenCalledWith("", "_blank");
      expect(tab.opener).toBeNull();
    } finally {
      open.mockRestore();
    }
  });

  it("closes the preview tab and shows the error when the token call fails", async () => {
    mockAuth = ADMIN;
    installApi({ endpoints: [endpoint()] });
    const tab = { opener: {}, location: { href: "" }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path: string, options: { method?: string } = {}) =>
      path.endsWith("/preview-token")
        ? Promise.reject(new Error("preview failed"))
        : base(path, options),
    );
    try {
      renderPage();
      fireEvent.click(await screen.findByRole("button", { name: "Preview" }));
      expect(await screen.findByText("preview failed")).toBeTruthy();
      expect(tab.close).toHaveBeenCalled();
    } finally {
      open.mockRestore();
    }
  });

  it("hides the public link while the shareable link is off and turns it on via PATCH", async () => {
    mockAuth = ADMIN;
    installApi({ endpoints: [endpoint({ shareable_link: false })] });
    renderPage();

    const toggle = await screen.findByRole("checkbox", { name: "Shareable link" });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByTestId("public-chat-link")).toBeNull();

    fireEvent.click(toggle);
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/public-chat/endpoints/1", {
        method: "PATCH",
        token: "tok",
        body: { shareable_link: true },
      }),
    );
  });

  it("shows and copies the public link when the shareable link is on", async () => {
    mockAuth = ADMIN;
    installApi({ endpoints: [endpoint({ slug: "support", shareable_link: true })] });
    vi.mocked(copyText).mockClear();
    renderPage();

    const link = await screen.findByTestId("public-chat-link");
    expect(link.textContent).toBe("http://gateway.test/public/chat/support");
    expect(
      (screen.getByRole("checkbox", { name: "Shareable link" }) as HTMLInputElement).checked,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Copy public link" }));
    await waitFor(() =>
      expect(copyText).toHaveBeenCalledWith("http://gateway.test/public/chat/support"),
    );
  });

  it("explains the embed only works on the allowed sites", async () => {
    mockAuth = ADMIN;
    installApi({
      endpoints: [
        endpoint({ allowed_origins: "https://a.example, https://b.example" }),
        endpoint({ id: 2, name: "Sales Bot", slug: "sales", allowed_origins: null }),
      ],
    });
    renderPage();

    expect(
      await screen.findByText(
        "The embed code only works on this chatbot's allowed sites: https://a.example, https://b.example.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "This chatbot has no allowed sites yet, so the embed code won't work on any website.",
      ),
    ).toBeTruthy();
  });

  it("shows the embed controls in Turkish", async () => {
    setLocale("tr");
    try {
      mockAuth = ADMIN;
      installApi({ endpoints: [endpoint({ slug: "support" })] });
      renderPage();

      expect(await screen.findByRole("button", { name: /Yerleştirme kodunu kopyala/ })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Önizle" })).toBeTruthy();
      expect(screen.getByRole("checkbox", { name: "Paylaşılabilir bağlantı" })).toBeTruthy();
    } finally {
      setLocale("en");
    }
  });

  it("shows an empty state when there are no endpoints", async () => {
    mockAuth = ADMIN;
    installApi({ endpoints: [] });
    renderPage();
    expect(
      await screen.findByText("No website chatbots yet."),
    ).toBeTruthy();
  });

  it("prompts to create an assistant first when none exist", async () => {
    mockAuth = ADMIN;
    installApi({ endpoints: [], pipelines: [] });
    renderPage();
    expect(
      await screen.findByText(
        "Create an assistant first — a website chatbot needs one to answer from.",
      ),
    ).toBeTruthy();
  });

  it("creates an endpoint from the form", async () => {
    mockAuth = ADMIN;
    installApi({ endpoints: [] });
    renderPage();
    await screen.findByText("No website chatbots yet.");

    fireEvent.click(screen.getByText("New chatbot"));

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
    await screen.findByText("No website chatbots yet.");

    fireEvent.click(screen.getByText("New chatbot"));
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
    const nameInput = await screen.findByLabelText("Chatbot name");
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
