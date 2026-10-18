import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import { documentStatusPoller } from "../lib/statusPoller";
import type { KnowledgeBase } from "../lib/types";
import {
  ChunkViewer,
  CreateKbForm,
  DocumentsList,
  KnowledgeBaseCard,
  KnowledgeBasesPage,
  UploadWidget,
} from "./KnowledgeBasesPage";

const apiFetch = vi.fn();

vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(), () => {}],
  Link: ({ to, children }: { to: string; children: ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

// The stepper self-fetches its own journey counts; stub it here so it doesn't
// pollute the apiFetch mock queue these page tests assert against (it has its
// own test coverage via lib/journey.test.ts + GoldenPathStepper.test.tsx).
vi.mock("../components/GoldenPathStepper", () => ({
  GoldenPathStepper: () => null,
}));

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => apiFetch(...args),
  };
});
vi.mock("../lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));
vi.mock("../components/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: vi.fn(), dialog: null }),
}));

function kb(overrides: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: "kb-1",
    name: "Support docs",
    description: "Customer-facing help articles",
    embedding_model: "nomic-embed-text",
    llm_model: "llama3",
    document_count: 2,
    vector_count: 40,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const NO_DEFAULTS = {
  answer: null,
  chat: null,
  extraction: null,
  utility: null,
  updated_at: null,
  updated_by: null,
};

// jsdom's File doesn't implement enough for the component's needs; the
// component only ever reads `.name` off each queued file and hands the File
// straight to FormData, so a plain object satisfying just that is enough.
function fakeFile(name: string) {
  return { name };
}

afterEach(() => {
  // Unmount BEFORE resetting the mock. cleanup() aborts any in-flight
  // useAsyncResource fetch (e.g. DocumentsList's docs load, or the reload()
  // that handleDelete kicks off) via its abort signal. If we reset first, a
  // still-mounted component could re-invoke apiFetch in the window before
  // unmount and get `undefined` back, so `apiFetch(...).then(...)` throws
  // "Cannot read properties of undefined (reading 'then')" during commit — a
  // flaky, cross-test CI failure that never reproduced in isolation.
  cleanup();
  apiFetch.mockReset();
  // Final safety net: any late/leaked call resolves to an empty page instead
  // of undefined, so it can never crash a subsequent test's render.
  apiFetch.mockResolvedValue({ items: [] });
});

// ChunkViewer is a pure presentational component (lazy-loads a document's
// stored chunk text on first expand) -- test it directly by prop, no full
// page mount needed.
describe("ChunkViewer", () => {
  it("fetches chunks only once expanded, not on initial render", () => {
    render(<ChunkViewer kbId="kb-1" documentId="doc-1" token="t" />);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("fetches and renders chunks in order when expanded", async () => {
    apiFetch.mockResolvedValue({
      items: [
        { chunk_index: 0, text: "Acme makes widgets." },
        { chunk_index: 1, text: "Founded in 1999." },
      ],
      total: 2,
      limit: 500,
      offset: 0,
    });
    render(<ChunkViewer kbId="kb-1" documentId="doc-1" token="t" />);

    fireEvent.click(screen.getByText("View chunks"));

    await screen.findByText("Acme makes widgets.");
    expect(screen.getByText("Founded in 1999.")).toBeTruthy();
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/rag/knowledge-bases/kb-1/documents/doc-1/chunks?limit=500",
      { token: "t" },
    );
  });

  it("does not re-fetch on a second expand", async () => {
    apiFetch.mockResolvedValue({
      items: [{ chunk_index: 0, text: "hello" }],
      total: 1,
      limit: 500,
      offset: 0,
    });
    const { container } = render(<ChunkViewer kbId="kb-1" documentId="doc-1" token="t" />);
    const summary = screen.getByText("View chunks");
    const details = container.querySelector("details")!;

    // jsdom's native <details> "toggle" event (what onToggle listens for)
    // resolves asynchronously relative to the click -- each click must be
    // awaited to settle before the next, or a rapid click/click pair can
    // net out to no observed state change at all (confirmed live: without
    // these awaits, this test passed even with the loaded-guard removed).
    fireEvent.click(summary); // open
    await waitFor(() => expect(details.open).toBe(true));
    await screen.findByText("hello");

    fireEvent.click(summary); // close
    await waitFor(() => expect(details.open).toBe(false));

    fireEvent.click(summary); // re-open
    await waitFor(() => expect(details.open).toBe(true));

    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("shows a friendly error when the fetch fails", async () => {
    apiFetch.mockRejectedValue(new Error("Knowledge base not found"));
    render(<ChunkViewer kbId="kb-1" documentId="doc-1" token="t" />);

    fireEvent.click(screen.getByText("View chunks"));

    await screen.findByText("Knowledge base not found");
  });
});

describe("UploadWidget", () => {
  it("shows a login hint and disables the file input when logged out", () => {
    render(<UploadWidget kb={kb()} token="" onUploaded={vi.fn()} />);
    expect(screen.getByText("Log in to upload documents.")).toBeTruthy();
    expect(
      (screen.getByLabelText(/Upload documents/) as HTMLInputElement).disabled,
    ).toBe(true);
  });

  it("queues selected files and does not show the upload button until files are chosen", () => {
    render(<UploadWidget kb={kb()} token="tok" onUploaded={vi.fn()} />);
    expect(screen.queryByText("Upload all")).toBeNull();

    fireEvent.change(screen.getByLabelText(/Upload documents/), {
      target: { files: [fakeFile("handbook.pdf")] },
    });

    expect(screen.getByText(/handbook.pdf — queued/)).toBeTruthy();
    expect(screen.getByText("Upload all")).toBeTruthy();
  });

  it("uploads each queued file, polls status, and reports per-file results", async () => {
    // #1081: upload returns "processing" immediately; the widget must then
    // poll .../status until it flips to "completed" before reporting counts.
    apiFetch
      .mockResolvedValueOnce({
        message: "accepted",
        document_id: "doc-1",
        filename: "handbook.pdf",
        status: "processing",
      })
      .mockResolvedValueOnce({
        message: "ok",
        document_id: "doc-1",
        filename: "handbook.pdf",
        status: "completed",
        chunks_processed: 3,
        vectors_created: 3,
      });
    const onUploaded = vi.fn();
    render(<UploadWidget kb={kb()} token="tok" onUploaded={onUploaded} />);

    fireEvent.change(screen.getByLabelText(/Upload documents/), {
      target: { files: [fakeFile("handbook.pdf")] },
    });
    fireEvent.click(screen.getByText("Upload all"));

    await screen.findByText(/handbook.pdf — done: 3 chunks, 3 vectors/);
    expect(onUploaded).toHaveBeenCalled();
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/rag/knowledge-bases/kb-1/upload",
      expect.objectContaining({ method: "POST", token: "tok" }),
    );
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/rag/knowledge-bases/kb-1/documents/doc-1/status",
      { token: "tok" },
    );
  });

  it("includes build_tree in the form data when the checkbox is on", async () => {
    apiFetch
      .mockResolvedValueOnce({
        message: "accepted",
        document_id: "doc-1",
        filename: "a.pdf",
        status: "processing",
      })
      .mockResolvedValueOnce({
        message: "ok",
        document_id: "doc-1",
        filename: "a.pdf",
        status: "completed",
        chunks_processed: 1,
        vectors_created: 1,
        tree_nodes_created: 4,
      });
    render(<UploadWidget kb={kb()} token="tok" onUploaded={vi.fn()} />);

    fireEvent.click(screen.getByLabelText(/Build search tree/));
    fireEvent.change(screen.getByLabelText(/Upload documents/), {
      target: { files: [fakeFile("a.pdf")] },
    });
    fireEvent.click(screen.getByText("Upload all"));

    await screen.findByText(/4 tree nodes/);
    const body = apiFetch.mock.calls[0][1].body as FormData;
    expect(body.get("build_tree")).toBe("true");
  });

  it("reports a per-file error without aborting the rest of the queue", async () => {
    apiFetch
      .mockRejectedValueOnce(new Error("file too large"))
      .mockResolvedValueOnce({
        message: "accepted",
        document_id: "doc-2",
        filename: "b.pdf",
        status: "processing",
      })
      .mockResolvedValueOnce({
        message: "ok",
        document_id: "doc-2",
        filename: "b.pdf",
        status: "completed",
        chunks_processed: 2,
        vectors_created: 2,
      });
    render(<UploadWidget kb={kb()} token="tok" onUploaded={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Upload documents/), {
      target: { files: [fakeFile("a.pdf"), fakeFile("b.pdf")] },
    });
    fireEvent.click(screen.getByText("Upload all"));

    await screen.findByText(/a.pdf — error: file too large/);
    await screen.findByText(/b.pdf — done: 2 chunks, 2 vectors/);
  });

  it("surfaces a background ingestion failure as a per-file error", async () => {
    apiFetch
      .mockResolvedValueOnce({
        message: "accepted",
        document_id: "doc-3",
        filename: "empty.pdf",
        status: "processing",
      })
      .mockResolvedValueOnce({
        message: "failed",
        document_id: "doc-3",
        filename: "empty.pdf",
        status: "failed",
        error: "No text content extracted",
      });
    render(<UploadWidget kb={kb()} token="tok" onUploaded={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Upload documents/), {
      target: { files: [fakeFile("empty.pdf")] },
    });
    fireEvent.click(screen.getByText("Upload all"));

    await screen.findByText(/empty.pdf — error: No text content extracted/);
  });

  describe("status polling under rate limits (#136)", () => {
    afterEach(() => vi.useRealTimers());

    const statusUrl = /\/documents\/([^/]+)\/status$/;

    it("finishes 10 simultaneous uploads despite injected 429s", async () => {
      vi.useFakeTimers();
      const statusCalls: Record<string, number> = {};
      let uploads = 0;
      apiFetch.mockImplementation(async (url: string) => {
        if (url.endsWith("/upload")) {
          const n = uploads++;
          return { message: "accepted", document_id: `doc-${n}`, filename: `f${n}.txt`, status: "processing" };
        }
        const docId = statusUrl.exec(url)![1];
        const n = (statusCalls[docId] = (statusCalls[docId] ?? 0) + 1);
        // Every document is rate limited twice (once with Retry-After, once
        // without), then reports progress, then completes.
        if (n === 1) throw new ApiError("Too many requests", 429, { retryAfterSeconds: 2 });
        if (n === 2) throw new ApiError("Too many requests", 429);
        if (n === 3) return { status: "processing" };
        return { status: "completed", chunks_processed: 5, vectors_created: 5 };
      });
      const onUploaded = vi.fn();
      render(<UploadWidget kb={kb()} token="tok" onUploaded={onUploaded} />);
      const files = Array.from({ length: 10 }, (_, i) => fakeFile(`f${i}.txt`));
      fireEvent.change(screen.getByLabelText(/Upload documents/), {
        target: { files },
      });
      fireEvent.click(screen.getByText("Upload all"));

      await act(() => vi.advanceTimersByTimeAsync(30_000));

      for (let i = 0; i < 10; i++) {
        expect(screen.getByText(`f${i}.txt — done: 5 chunks, 5 vectors`)).toBeTruthy();
      }
      expect(screen.queryByText(/error/)).toBeNull();
      expect(onUploaded).toHaveBeenCalledTimes(1);
      expect(Object.values(statusCalls)).toEqual(Array(10).fill(4));
      expect(documentStatusPoller.size).toBe(0);
    });

    it("stops polling when the widget unmounts", async () => {
      vi.useFakeTimers();
      apiFetch.mockImplementation(async (url: string) =>
        url.endsWith("/upload")
          ? { message: "accepted", document_id: "doc-1", filename: "a.pdf", status: "processing" }
          : { status: "processing" },
      );
      const onUploaded = vi.fn();
      const { unmount } = render(
        <UploadWidget kb={kb()} token="tok" onUploaded={onUploaded} />,
      );
      fireEvent.change(screen.getByLabelText(/Upload documents/), {
        target: { files: [fakeFile("a.pdf")] },
      });
      fireEvent.click(screen.getByText("Upload all"));
      await act(() => vi.advanceTimersByTimeAsync(10_000));
      const callsBefore = apiFetch.mock.calls.length;
      expect(callsBefore).toBeGreaterThan(1);

      unmount();
      await vi.advanceTimersByTimeAsync(120_000);

      expect(apiFetch.mock.calls.length).toBe(callsBefore);
      expect(documentStatusPoller.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(onUploaded).not.toHaveBeenCalled();
    });
  });
});

describe("DocumentsList", () => {
  it("renders nothing until the first load settles", () => {
    apiFetch.mockReturnValue(new Promise(() => {}));
    const { container } = render(
      <DocumentsList kbId="kb-1" token="tok" refreshToken={0} onDeleted={vi.fn()} confirm={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows an empty state when there are no documents", async () => {
    apiFetch.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
    render(
      <DocumentsList kbId="kb-1" token="tok" refreshToken={0} onDeleted={vi.fn()} confirm={vi.fn()} />,
    );
    await screen.findByText(/No documents uploaded yet/);
  });

  it("shows an empty state (not a crash) when the response omits `items` entirely", async () => {
    apiFetch.mockResolvedValue({});
    render(
      <DocumentsList kbId="kb-1" token="tok" refreshToken={0} onDeleted={vi.fn()} confirm={vi.fn()} />,
    );
    await screen.findByText(/No documents uploaded yet/);
  });

  it("lists documents and shows a distinct error state on fetch failure", async () => {
    apiFetch.mockRejectedValue(new Error("rag-pipeline unreachable"));
    render(
      <DocumentsList kbId="kb-1" token="tok" refreshToken={0} onDeleted={vi.fn()} confirm={vi.fn()} />,
    );
    await screen.findByText("Couldn't load documents — see error below.");
    expect(screen.getByText("rag-pipeline unreachable")).toBeTruthy();
  });

  it("does not delete a document when the confirmation is declined", async () => {
    apiFetch.mockResolvedValue({
      items: [{ document_id: "doc-1", filename: "a.pdf", chunk_count: 3 }],
      total: 1,
      limit: 100,
      offset: 0,
    });
    const confirm = vi.fn().mockResolvedValue(false);
    const onDeleted = vi.fn();
    render(
      <DocumentsList kbId="kb-1" token="tok" refreshToken={0} onDeleted={onDeleted} confirm={confirm} />,
    );
    await screen.findByText(/a.pdf/);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());

    expect(apiFetch).toHaveBeenCalledTimes(1); // only the initial list load
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("deletes a document once confirmed and reloads the list", async () => {
    apiFetch
      .mockResolvedValueOnce({
        items: [{ document_id: "doc-1", filename: "a.pdf", chunk_count: 3 }],
        total: 1,
        limit: 100,
        offset: 0,
      })
      .mockResolvedValueOnce({}) // the DELETE call
      .mockResolvedValueOnce({ items: [], total: 0, limit: 100, offset: 0 }); // reload
    const confirm = vi.fn().mockResolvedValue(true);
    const onDeleted = vi.fn();
    render(
      <DocumentsList kbId="kb-1" token="tok" refreshToken={0} onDeleted={onDeleted} confirm={confirm} />,
    );
    await screen.findByText(/a.pdf/);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/rag/knowledge-bases/kb-1/documents/doc-1",
      { method: "DELETE", token: "tok" },
    );
  });

  it("shows a friendly error when delete fails", async () => {
    apiFetch
      .mockResolvedValueOnce({
        items: [{ document_id: "doc-1", filename: "a.pdf", chunk_count: 3 }],
        total: 1,
        limit: 100,
        offset: 0,
      })
      .mockRejectedValueOnce(new Error("rag-pipeline unreachable"));
    const confirm = vi.fn().mockResolvedValue(true);
    render(
      <DocumentsList kbId="kb-1" token="tok" refreshToken={0} onDeleted={vi.fn()} confirm={confirm} />,
    );
    await screen.findByText(/a.pdf/);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await screen.findByText("rag-pipeline unreachable");
  });
});

describe("KnowledgeBaseCard", () => {
  it("shows a login hint and disables edit/delete when logged out", () => {
    apiFetch.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
    render(
      <KnowledgeBaseCard kb={kb()} token="" onDeleted={vi.fn()} onRefresh={vi.fn()} confirm={vi.fn()} />,
    );
    expect(screen.getByText("Log in to edit or delete this knowledge base.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Delete KB" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("rejects an empty name on save", async () => {
    apiFetch.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
    render(
      <KnowledgeBaseCard kb={kb()} token="tok" onDeleted={vi.fn()} onRefresh={vi.fn()} confirm={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Knowledge base name"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Name can't be empty.");
  });

  it("saves an edit and exits edit mode", async () => {
    apiFetch.mockImplementation((_path: string, opts?: { method?: string }) => {
      if (opts?.method === "PATCH") return Promise.resolve(kb({ name: "Renamed" }));
      return Promise.resolve({ items: [], total: 0, limit: 100, offset: 0 });
    });
    const onRefresh = vi.fn();
    render(
      <KnowledgeBaseCard kb={kb()} token="tok" onDeleted={vi.fn()} onRefresh={onRefresh} confirm={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Knowledge base name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onRefresh).toHaveBeenCalledWith(kb({ name: "Renamed" })));
    expect(screen.queryByLabelText("Knowledge base name")).toBeNull();
  });

  it("cancels an edit without saving", () => {
    apiFetch.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
    render(
      <KnowledgeBaseCard kb={kb()} token="tok" onDeleted={vi.fn()} onRefresh={vi.fn()} confirm={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Knowledge base name"), { target: { value: "Discard" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByText("Support docs")).toBeTruthy();
  });

  it("does not delete when the confirmation is declined", async () => {
    apiFetch.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
    const confirm = vi.fn().mockResolvedValue(false);
    const onDeleted = vi.fn();
    render(
      <KnowledgeBaseCard kb={kb()} token="tok" onDeleted={onDeleted} onRefresh={vi.fn()} confirm={confirm} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete KB" }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());

    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("deletes the knowledge base once confirmed", async () => {
    apiFetch.mockImplementation((_path: string, opts?: { method?: string }) => {
      if (opts?.method === "DELETE") return Promise.resolve({});
      return Promise.resolve({ items: [], total: 0, limit: 100, offset: 0 });
    });
    const confirm = vi.fn().mockResolvedValue(true);
    const onDeleted = vi.fn();
    render(
      <KnowledgeBaseCard kb={kb()} token="tok" onDeleted={onDeleted} onRefresh={vi.fn()} confirm={confirm} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete KB" }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("kb-1"));
  });

  it("shows a friendly error when delete fails", async () => {
    apiFetch.mockImplementation((_path: string, opts?: { method?: string }) => {
      if (opts?.method === "DELETE") return Promise.reject(new Error("rag-pipeline unreachable"));
      return Promise.resolve({ items: [], total: 0, limit: 100, offset: 0 });
    });
    const confirm = vi.fn().mockResolvedValue(true);
    render(
      <KnowledgeBaseCard kb={kb()} token="tok" onDeleted={vi.fn()} onRefresh={vi.fn()} confirm={confirm} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete KB" }));

    await screen.findByText("rag-pipeline unreachable");
  });

  // ── #1046 (Phase 4 slice 5): visibility/team sharing ────────────────────

  it("shows a private badge by default", () => {
    apiFetch.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
    render(
      <KnowledgeBaseCard kb={kb()} token="tok" onDeleted={vi.fn()} onRefresh={vi.fn()} confirm={vi.fn()} />,
    );
    expect(screen.getByText("🔒 Private (only me)")).toBeTruthy();
  });

  it("shows the shared badge", () => {
    apiFetch.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
    render(
      <KnowledgeBaseCard
        kb={kb({ visibility: "shared" })}
        token="tok"
        onDeleted={vi.fn()}
        onRefresh={vi.fn()}
        confirm={vi.fn()}
      />,
    );
    expect(screen.getByText("🌐 Shared (everyone)")).toBeTruthy();
  });

  it("shows the team badge with the resolved team name", () => {
    apiFetch.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
    render(
      <KnowledgeBaseCard
        kb={kb({ visibility: "team", team_id: 7 })}
        token="tok"
        myTeams={[{ id: 7, name: "Engineering" }]}
        onDeleted={vi.fn()}
        onRefresh={vi.fn()}
        confirm={vi.fn()}
      />,
    );
    expect(screen.getByText("👥 Shared with team: Engineering")).toBeTruthy();
  });

  it("requires a team to be chosen before saving team visibility", async () => {
    apiFetch.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
    render(
      <KnowledgeBaseCard
        kb={kb()}
        token="tok"
        myTeams={[{ id: 7, name: "Engineering" }]}
        onDeleted={vi.fn()}
        onRefresh={vi.fn()}
        confirm={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Visibility"), { target: { value: "team" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Choose a team to share this knowledge base with.");
  });

  it("saves visibility and team_id together", async () => {
    apiFetch.mockImplementation((_path: string, opts?: { method?: string; body?: unknown }) => {
      if (opts?.method === "PATCH") {
        return Promise.resolve(kb({ visibility: "team", team_id: 7 }));
      }
      return Promise.resolve({ items: [], total: 0, limit: 100, offset: 0 });
    });
    const onRefresh = vi.fn();
    render(
      <KnowledgeBaseCard
        kb={kb()}
        token="tok"
        myTeams={[{ id: 7, name: "Engineering" }]}
        onDeleted={vi.fn()}
        onRefresh={onRefresh}
        confirm={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Visibility"), { target: { value: "team" } });
    fireEvent.change(screen.getByLabelText("Team to share with"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/v1/rag/knowledge-bases/kb-1",
        expect.objectContaining({
          method: "PATCH",
          body: expect.objectContaining({ visibility: "team", team_id: 7 }),
        }),
      ),
    );
    expect(onRefresh).toHaveBeenCalledWith(kb({ visibility: "team", team_id: 7 }));
  });

  it("clears team_id when switching away from team visibility", async () => {
    apiFetch.mockImplementation((_path: string, opts?: { method?: string }) => {
      if (opts?.method === "PATCH") return Promise.resolve(kb({ visibility: "private" }));
      return Promise.resolve({ items: [], total: 0, limit: 100, offset: 0 });
    });
    render(
      <KnowledgeBaseCard
        kb={kb({ visibility: "team", team_id: 7 })}
        token="tok"
        myTeams={[{ id: 7, name: "Engineering" }]}
        onDeleted={vi.fn()}
        onRefresh={vi.fn()}
        confirm={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Visibility"), { target: { value: "private" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/v1/rag/knowledge-bases/kb-1",
        expect.objectContaining({
          body: expect.objectContaining({ visibility: "private", team_id: null }),
        }),
      ),
    );
  });
});

describe("CreateKbForm", () => {
  it("requires a name", async () => {
    apiFetch.mockResolvedValue({ items: [] });
    render(<CreateKbForm token="tok" onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await screen.findByText("Name is required.");
    // The one apiFetch call so far is the background model-list fetch, not a create.
    expect(apiFetch).not.toHaveBeenCalledWith("/v1/rag/knowledge-bases", expect.anything());
  });

  it("creates a knowledge base with only the required fields and resets the form", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/v1/models")) return Promise.resolve({ items: [] });
      return Promise.resolve(kb());
    });
    const onCreated = vi.fn();
    render(<CreateKbForm token="tok" onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Support docs" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(kb()));
    expect(apiFetch).toHaveBeenCalledWith("/v1/rag/knowledge-bases", {
      method: "POST",
      body: { name: "Support docs" },
      token: "tok",
    });
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
  });

  it("includes optional fields, parsing chunk size/overlap as numbers", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/v1/models")) return Promise.resolve({ items: [] });
      return Promise.resolve(kb());
    });
    render(<CreateKbForm token="tok" onCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Support docs" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Help articles" } });
    fireEvent.change(screen.getByLabelText("Chunk size"), { target: { value: "512" } });
    fireEvent.change(screen.getByLabelText("Chunk overlap"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/rag/knowledge-bases", {
        method: "POST",
        body: {
          name: "Support docs",
          description: "Help articles",
          chunk_size: 512,
          chunk_overlap: 50,
        },
        token: "tok",
      }),
    );
  });

  it("splits the fetched model list into embedding vs. LLM dropdowns by name", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/v1/models")) {
        return Promise.resolve({
          items: [
            { id: "m1", name: "nomic-embed-text" },
            { id: "m2", name: "llama3" },
            // #1756: bge-m3 is a real, popular embedding-only model whose tag
            // doesn't contain "embed" -- must classify as embedding, not LLM.
            { id: "m3", name: "bge-m3" },
          ],
        });
      }
      return Promise.resolve(kb());
    });
    render(<CreateKbForm token="tok" onCreated={vi.fn()} />);

    await screen.findByRole("option", { name: "nomic-embed-text" });
    const embeddingSelect = screen.getByLabelText("Embedding model") as HTMLSelectElement;
    const llmSelect = screen.getByLabelText("LLM model") as HTMLSelectElement;
    expect(
      Array.from(embeddingSelect.options).some((o) => o.value === "llama3"),
    ).toBe(false);
    expect(
      Array.from(llmSelect.options).some((o) => o.value === "nomic-embed-text"),
    ).toBe(false);
    expect(Array.from(llmSelect.options).some((o) => o.value === "llama3")).toBe(true);
    expect(
      Array.from(embeddingSelect.options).some((o) => o.value === "bge-m3"),
    ).toBe(true);
    expect(Array.from(llmSelect.options).some((o) => o.value === "bge-m3")).toBe(
      false,
    );
  });

  it("degrades gracefully to just the default option when the model list fails to load", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/v1/models")) return Promise.reject(new Error("unreachable"));
      return Promise.resolve(kb());
    });
    render(<CreateKbForm token="tok" onCreated={vi.fn()} />);

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const embeddingSelect = screen.getByLabelText("Embedding model") as HTMLSelectElement;
    expect(embeddingSelect.options.length).toBe(1);
  });

  it("shows a friendly error on create failure", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/v1/models")) return Promise.resolve({ items: [] });
      return Promise.reject(new Error("rag-pipeline unreachable"));
    });
    render(<CreateKbForm token="tok" onCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Support docs" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await screen.findByText("rag-pipeline unreachable");
  });

  it("shows a login hint and disables submit when logged out", () => {
    apiFetch.mockResolvedValue({ items: [] });
    render(<CreateKbForm token="" onCreated={vi.fn()} />);
    expect(screen.getByText("Log in to create a knowledge base.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("KnowledgeBasesPage", () => {
  it("loads knowledge bases on mount", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/v1/rag/knowledge-bases?")) return Promise.resolve({ items: [kb()] });
      if (path.startsWith("/v1/models")) return Promise.resolve({ items: [] });
      if (path.startsWith("/v1/rag/knowledge-bases/kb-1/documents")) {
        return Promise.resolve({ items: [], total: 0, limit: 100, offset: 0 });
      }
      if (path.startsWith("/v1/teams")) return Promise.resolve({ teams: [] });
      if (path === "/v1/model-defaults") return Promise.resolve(NO_DEFAULTS);
      throw new Error(`unexpected path ${path}`);
    });
    render(<KnowledgeBasesPage />);

    expect(await screen.findByText("Support docs")).toBeTruthy();
  });

  it("shows an empty state when there are no knowledge bases", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/v1/rag/knowledge-bases?")) return Promise.resolve({ items: [] });
      if (path.startsWith("/v1/models")) return Promise.resolve({ items: [] });
      if (path.startsWith("/v1/teams")) return Promise.resolve({ teams: [] });
      if (path === "/v1/model-defaults") return Promise.resolve(NO_DEFAULTS);
      throw new Error(`unexpected path ${path}`);
    });
    render(<KnowledgeBasesPage />);

    await screen.findByText("No knowledge bases yet — create one above to get started.");
  });

  it("shows a friendly error status when the initial load fails", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/v1/rag/knowledge-bases?")) return Promise.reject(new Error("rag-pipeline unreachable"));
      if (path.startsWith("/v1/models")) return Promise.resolve({ items: [] });
      if (path.startsWith("/v1/teams")) return Promise.resolve({ teams: [] });
      if (path === "/v1/model-defaults") return Promise.resolve(NO_DEFAULTS);
      throw new Error(`unexpected path ${path}`);
    });
    render(<KnowledgeBasesPage />);

    await screen.findByText("rag-pipeline unreachable");
  });

  it("filters knowledge bases by name and shows a no-match empty state", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/v1/rag/knowledge-bases?")) {
        return Promise.resolve({
          items: [kb({ id: "kb-1", name: "Support" }), kb({ id: "kb-2", name: "Sales" })],
        });
      }
      if (path.startsWith("/v1/models")) return Promise.resolve({ items: [] });
      if (path.includes("/documents")) return Promise.resolve({ items: [], total: 0, limit: 100, offset: 0 });
      if (path.startsWith("/v1/teams")) return Promise.resolve({ teams: [] });
      if (path === "/v1/model-defaults") return Promise.resolve(NO_DEFAULTS);
      throw new Error(`unexpected path ${path}`);
    });
    render(<KnowledgeBasesPage />);
    await screen.findByText("Support");

    fireEvent.change(screen.getByLabelText("Filter knowledge bases"), { target: { value: "sal" } });
    expect(screen.getByText("Sales")).toBeTruthy();
    expect(screen.queryByText("Support")).toBeNull();
    expect(screen.getByText("1 of 2")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Filter knowledge bases"), { target: { value: "nope" } });
    await screen.findByText('No knowledge bases match "nope".');
  });

  it("fetches teams and passes them down for the team picker", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/v1/rag/knowledge-bases?")) {
        return Promise.resolve({ items: [kb({ visibility: "team", team_id: 7 })] });
      }
      if (path.startsWith("/v1/models")) return Promise.resolve({ items: [] });
      if (path.startsWith("/v1/rag/knowledge-bases/kb-1/documents")) {
        return Promise.resolve({ items: [], total: 0, limit: 100, offset: 0 });
      }
      if (path.startsWith("/v1/teams")) {
        return Promise.resolve({ teams: [{ id: 7, name: "Engineering" }] });
      }
      if (path === "/v1/model-defaults") return Promise.resolve(NO_DEFAULTS);
      throw new Error(`unexpected path ${path}`);
    });
    render(<KnowledgeBasesPage />);

    await screen.findByText("👥 Shared with team: Engineering");
  });
});

describe("model defaults and data policy (#2523 / #2525)", () => {
  const CHOICES = {
    models: [
      { id: "llama3", name: "llama3", status: "ready" },
      { id: "nomic-embed-text", name: "nomic-embed-text", status: "ready" },
      { id: "remote:p1:gpt-4o", name: "gpt-4o", provider: "OpenAI", status: "ready" },
    ],
    defaults: { ...NO_DEFAULTS, answer: "remote:p1:gpt-4o" },
    localProviders: new Set<string>(),
  };

  function renderCard(overrides: Partial<KnowledgeBase>, onRefresh = vi.fn()) {
    render(
      <KnowledgeBaseCard
        kb={kb(overrides)}
        token="tok"
        choices={CHOICES}
        onDeleted={vi.fn()}
        onRefresh={onRefresh}
        confirm={vi.fn()}
      />,
    );
  }

  it("shows a KB that follows the org default, and a pinned KB's own model", () => {
    apiFetch.mockResolvedValue({ items: [] });
    renderCard({ llm_model: "" });
    expect(screen.getByText(/answer\s+model: Org default \(gpt-4o \(OpenAI\)\)/)).toBeTruthy();
    cleanup();
    renderCard({ llm_model: "llama3" });
    expect(screen.getByText(/answer\s+model: llama3/)).toBeTruthy();
  });

  it("marks a Local only KB with a lock badge", () => {
    apiFetch.mockResolvedValue({ items: [] });
    renderCard({ data_policy: "local_only" });
    expect(screen.getByText("Local only")).toBeTruthy();
  });

  it("disables cloud models in a Local only KB's picker and explains why", () => {
    apiFetch.mockResolvedValue({ items: [] });
    renderCard({ data_policy: "local_only", llm_model: "" });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const picker = screen.getByLabelText("Answer model") as HTMLSelectElement;
    const options = Array.from(picker.options);
    expect(options[0].value).toBe("");
    expect(options[0].textContent).toBe("Org default (gpt-4o (OpenAI))");
    const cloud = options.find((o) => o.value === "remote:p1:gpt-4o")!;
    expect(cloud.disabled).toBe(true);
    expect(cloud.textContent).toMatch(/Cloud \(not allowed: Local only\)/);
    expect(options.find((o) => o.value === "llama3")!.disabled).toBe(false);
    // Embedding-only models never answer.
    expect(options.some((o) => o.value === "nomic-embed-text")).toBe(false);
    expect(screen.getByText(/its content is never sent to a cloud model/)).toBeTruthy();
    // The cloud org default would be refused -- say so.
    expect(screen.getByText(/is a cloud model, so\s+questions to this knowledge base will be refused/)).toBeTruthy();
  });

  it("switching to Local only drops a pinned cloud model and sends both changes", async () => {
    apiFetch.mockImplementation((_path: string, opts?: { method?: string }) =>
      opts?.method === "PATCH"
        ? Promise.resolve(kb({ data_policy: "local_only", llm_model: "" }))
        : Promise.resolve({ items: [] }),
    );
    renderCard({ llm_model: "remote:p1:gpt-4o" });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Data policy"), { target: { value: "local_only" } });
    expect((screen.getByLabelText("Answer model") as HTMLSelectElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/v1/rag/knowledge-bases/kb-1",
        expect.objectContaining({
          method: "PATCH",
          body: expect.objectContaining({ data_policy: "local_only", llm_model: "" }),
        }),
      ),
    );
  });

  it("leaves an untouched model and policy out of the PATCH", async () => {
    apiFetch.mockImplementation((_path: string, opts?: { method?: string }) =>
      opts?.method === "PATCH" ? Promise.resolve(kb()) : Promise.resolve({ items: [] }),
    );
    renderCard({ data_policy: "local_only" });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/v1/rag/knowledge-bases/kb-1",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    const patch = apiFetch.mock.calls.find((c) => c[1]?.method === "PATCH")!;
    expect(patch[1].body).not.toHaveProperty("data_policy");
    expect(patch[1].body).not.toHaveProperty("llm_model");
  });

  it("explains a refused loosening (403) and keeps the form open", async () => {
    apiFetch.mockImplementation((_path: string, opts?: { method?: string }) =>
      opts?.method === "PATCH"
        ? Promise.reject(new ApiError("Insufficient permissions", 403))
        : Promise.resolve({ items: [] }),
    );
    renderCard({ data_policy: "local_only" });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Data policy"), { target: { value: "cloud_allowed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText(
        "Only the knowledge base owner or an org admin can switch a Local only knowledge base back to Cloud allowed.",
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText("Data policy")).toBeTruthy();
  });

  it("creates a Local only KB that follows the org default", async () => {
    apiFetch.mockResolvedValue(kb({ data_policy: "local_only" }));
    const onCreated = vi.fn();
    render(<CreateKbForm token="tok" choices={CHOICES} onCreated={onCreated} />);
    expect(
      (screen.getByLabelText("LLM model") as HTMLSelectElement).options[0].textContent,
    ).toBe("Org default (gpt-4o (OpenAI))");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Secrets" } });
    fireEvent.change(screen.getByLabelText("Data policy"), { target: { value: "local_only" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/v1/rag/knowledge-bases", {
        method: "POST",
        body: { name: "Secrets", data_policy: "local_only" },
        token: "tok",
      }),
    );
  });
});
