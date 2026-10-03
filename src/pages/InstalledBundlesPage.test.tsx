import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Bundle } from "../lib/bundles";
import { ExportImportPanel, InstalledBundlesPage } from "./InstalledBundlesPage";

const apiFetch = vi.fn();
const onChanged = vi.fn();

vi.mock("../lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  friendlyErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
}));
let mockAuth = { token: "tok", role: "admin" };
vi.mock("../lib/auth", () => ({
  useAuth: () => mockAuth,
}));

function bundle(overrides: Partial<Bundle> = {}): Bundle {
  return {
    name: "monitoring",
    core: false,
    enabled: false,
    claims: [],
    services: [],
    ...overrides,
  };
}

// jsdom's Blob/File doesn't implement .text() in this environment -- the
// component only ever calls file.text(), so a plain object satisfying just
// that (not a real File instance) sidesteps the gap entirely.
function fakeFile(text: string) {
  return { text: () => Promise.resolve(text) };
}

function importFile(content: unknown) {
  const file = fakeFile(JSON.stringify(content));
  const input = screen.getByLabelText("Import bundle state from a JSON file");
  fireEvent.change(input, { target: { files: [file] } });
}

/** The import's confirm dialog, once the file has been read and previewed. */
async function previewDialog() {
  return screen.findByRole("alertdialog");
}

/** The visible reason text a disabled control points to. */
function describedBy(el: HTMLElement) {
  const id = el.getAttribute("aria-describedby");
  return id ? document.getElementById(id)?.textContent : null;
}

describe("InstalledBundlesPage", () => {
  afterEach(() => {
    cleanup();
    apiFetch.mockReset();
    mockAuth = { token: "tok", role: "admin" };
  });

  it("shows only the enabled bundles", async () => {
    apiFetch.mockResolvedValue({
      bundles: [
        bundle({ name: "core", enabled: true }),
        bundle({ name: "monitoring", enabled: false }),
        bundle({ name: "voice", enabled: true }),
      ],
      count: 3,
    });
    render(<InstalledBundlesPage />, { wrapper: MemoryRouter });

    expect(await screen.findByText("core")).toBeTruthy();
    expect(screen.getByText("voice")).toBeTruthy();
    expect(screen.queryByText("monitoring")).toBeNull();
  });

  it("shows an empty state when no bundle is enabled", async () => {
    apiFetch.mockResolvedValue({
      bundles: [bundle({ name: "monitoring", enabled: false })],
      count: 1,
    });
    render(<InstalledBundlesPage />, { wrapper: MemoryRouter });

    expect(await screen.findByText(/No service bundles are enabled yet/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Discover service bundles" }).getAttribute("href"),
    ).toBe("/marketplace/discover/service-bundles");
  });

  it("shows an orphaned-services warning banner listing every orphan", async () => {
    apiFetch.mockResolvedValue({
      bundles: [bundle({ name: "core", enabled: true })],
      count: 1,
      orphaned: ["old-worker", "stale-cache"],
    });
    render(<InstalledBundlesPage />, { wrapper: MemoryRouter });

    const banner = await screen.findByText(/Orphaned services/);
    expect(banner.textContent).toContain("old-worker, stale-cache");
  });

  it("reconciles successfully and reports the outcome, then reloads", async () => {
    apiFetch
      .mockResolvedValueOnce({ bundles: [bundle({ name: "core", enabled: true })], count: 1 })
      .mockResolvedValueOnce({
        started: ["worker"],
        already_running: [],
        pending_create: [],
        stopped: [],
        already_stopped: [],
        errors: [],
      })
      .mockResolvedValueOnce({ bundles: [bundle({ name: "core", enabled: true })], count: 1 });
    render(<InstalledBundlesPage />, { wrapper: MemoryRouter });

    fireEvent.click(await screen.findByRole("button", { name: /Reconcile/ }));

    await screen.findByText(/Reconciled: started worker/);
    expect(apiFetch).toHaveBeenCalledWith("/v1/bundles/reconcile", {
      method: "POST",
      token: "tok",
    });
    // Success reload -- a 3rd call beyond the initial load + the reconcile itself.
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(3));
  });

  it("shows a friendly error when reconcile fails, without reloading", async () => {
    apiFetch
      .mockResolvedValueOnce({ bundles: [bundle({ name: "core", enabled: true })], count: 1 })
      .mockRejectedValueOnce(new Error("plugin-registry unreachable"));
    render(<InstalledBundlesPage />, { wrapper: MemoryRouter });

    fireEvent.click(await screen.findByRole("button", { name: /Reconcile/ }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("plugin-registry unreachable");
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("disables Reconcile with a login hint when logged out", async () => {
    mockAuth = { token: "", role: "" };
    apiFetch.mockResolvedValue({ bundles: [bundle({ name: "core", enabled: true })], count: 1 });
    render(<InstalledBundlesPage />, { wrapper: MemoryRouter });

    const btn = await screen.findByRole("button", { name: /Reconcile/ });
    expect(btn.hasAttribute("disabled")).toBe(true);
    // Visible text associated with the button -- not a hover-only title.
    expect(screen.getByText("Log in as an admin to reconcile.")).toBeTruthy();
    expect(describedBy(btn)).toBe("Log in as an admin to reconcile.");
    expect(btn.getAttribute("title")).toBeNull();
  });

  it("disables Reconcile with an admin-role hint when logged in but not admin", async () => {
    mockAuth = { token: "tok", role: "member" };
    apiFetch.mockResolvedValue({ bundles: [bundle({ name: "core", enabled: true })], count: 1 });
    render(<InstalledBundlesPage />, { wrapper: MemoryRouter });

    const btn = await screen.findByRole("button", { name: /Reconcile/ });
    expect(btn.hasAttribute("disabled")).toBe(true);
    expect(describedBy(btn)).toBe("Only an admin can reconcile.");
    expect(btn.getAttribute("title")).toBeNull();
    // The import is admin-only too, with its reason shown the same way.
    const input = screen.getByLabelText("Import bundle state from a JSON file");
    expect(input.hasAttribute("disabled")).toBe(true);
    expect(describedBy(input)).toBe("Only an admin can import bundle state.");
  });

  it("shows a skeleton, not the empty state, while loading; an error offers Retry (#2195)", async () => {
    let reject!: (e: unknown) => void;
    apiFetch.mockReturnValueOnce(new Promise((_, r) => (reject = r)));
    render(<InstalledBundlesPage />, { wrapper: MemoryRouter });

    expect(screen.getByTestId("card-list-skeleton")).toBeTruthy();
    expect(screen.queryByText(/No service bundles are enabled yet/)).toBeNull();

    reject(new Error("bundle reconciler down"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't load the service bundles.");
    expect(screen.queryByText(/No service bundles are enabled yet/)).toBeNull();

    apiFetch.mockResolvedValueOnce({ bundles: [bundle({ name: "voice", enabled: true })], count: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Retry loading service bundles" }));
    expect(await screen.findByRole("heading", { level: 3, name: "voice" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("nests bundle cards (h3) under an 'Enabled bundles' h2", async () => {
    apiFetch.mockResolvedValue({ bundles: [bundle({ name: "voice", enabled: true })], count: 1 });
    render(<InstalledBundlesPage />, { wrapper: MemoryRouter });

    await screen.findByRole("heading", { level: 3, name: "voice" });
    expect(
      screen.getAllByRole("heading").map((h) => `${h.tagName}:${h.textContent?.trim()}`),
    ).toEqual(["H1:Installed service bundles", "H2:Export / Import", "H2:Enabled bundles", "H3:voice"]);
  });
});

describe("ExportImportPanel import: preview, confirm, cancel (#2195)", () => {
  afterEach(() => {
    cleanup();
    apiFetch.mockReset();
    onChanged.mockReset();
  });

  function renderPanel(bundles: Bundle[], isAdmin = true) {
    render(
      <ExportImportPanel bundles={bundles} token="tok" isAdmin={isAdmin} onChanged={onChanged} />,
    );
  }

  it("previews the changes and makes no request until confirmed", async () => {
    apiFetch.mockResolvedValue({});
    renderPanel([
      bundle({ name: "monitoring", enabled: false }),
      bundle({ name: "voice", enabled: true }),
      bundle({ name: "chat", enabled: true }),
      bundle({ name: "core-services", core: true, enabled: true }),
    ]);

    importFile({
      monitoring: { enabled: true },
      voice: { enabled: false },
      chat: { enabled: true },
      "core-services": { enabled: false },
      "no-such-bundle": { enabled: true },
    });

    const dialog = await previewDialog();
    expect(within(dialog).getByRole("heading", { name: "Apply 2 bundle changes?" })).toBeTruthy();
    const text = dialog.textContent!;
    expect(text).toContain("Will be enabled (1)monitoring");
    expect(text).toContain("Will be disabled");
    expect(text).toMatch(/Will be disabled[^)]*\) \(1\)voice/);
    expect(text).toContain("Already as requested (1)chat");
    expect(text).toContain("Skipped (2)core-services (core can't be disabled)no-such-bundle (unknown bundle)");
    // The preview is part of the dialog's description, read with the question.
    expect(describedBy(dialog)).toContain("Will be enabled (1)monitoring");
    expect(apiFetch).not.toHaveBeenCalled();

    // Disabling stops services, so the confirm button carries the danger style.
    const apply = within(dialog).getByRole("button", { name: "Apply 2 changes" });
    expect(apply.className).toContain("bg-red-600");
    fireEvent.click(apply);

    await screen.findByText(
      "applied: monitoring, voice — skipped: core-services (core can't be disabled), no-such-bundle (unknown bundle)",
    );
    expect(apiFetch.mock.calls).toEqual([
      ["/v1/bundles/monitoring/enable", { method: "POST", token: "tok" }],
      ["/v1/bundles/voice/disable", { method: "POST", token: "tok" }],
    ]);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("Cancel makes no request and says nothing changed", async () => {
    renderPanel([bundle({ name: "monitoring", enabled: false })]);

    importFile({ monitoring: { enabled: true } });
    const dialog = await previewDialog();
    expect(within(dialog).getByRole("button", { name: "Apply 1 change" }).className).not.toContain(
      "bg-red-600",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await screen.findByText("Import cancelled — nothing was changed.");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    // The same file can be picked again straight away.
    expect(
      (screen.getByLabelText("Import bundle state from a JSON file") as HTMLInputElement).value,
    ).toBe("");
  });

  it("Escape cancels too, without a request", async () => {
    renderPanel([bundle({ name: "monitoring", enabled: false })]);

    importFile({ monitoring: { enabled: true } });
    fireEvent.keyDown(await previewDialog(), { key: "Escape" });

    await screen.findByText("Import cancelled — nothing was changed.");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("needs no confirmation when nothing would change, and makes no request", async () => {
    renderPanel([bundle({ name: "monitoring", enabled: true })]);

    importFile({ monitoring: { enabled: true } });

    await screen.findByText("Nothing to change.");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("reports what it skipped when nothing is actionable (unknown bundle, core disable)", async () => {
    renderPanel([bundle({ name: "core-services", core: true, enabled: true })]);

    importFile({ "no-such-bundle": { enabled: true }, "core-services": { enabled: false } });

    await screen.findByText(
      "Nothing to change — skipped: no-such-bundle (unknown bundle), core-services (core can't be disabled)",
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("records a per-bundle API failure without aborting the rest of the import", async () => {
    apiFetch.mockImplementation((url: string) =>
      url.includes("monitoring")
        ? Promise.reject(new Error("plugin-registry unreachable"))
        : Promise.resolve({}),
    );
    renderPanel([
      bundle({ name: "monitoring", enabled: false }),
      bundle({ name: "voice", enabled: false }),
    ]);

    importFile({ monitoring: { enabled: true }, voice: { enabled: true } });
    fireEvent.click(
      within(await previewDialog()).getByRole("button", { name: "Apply 2 changes" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("applied: voice — errors: monitoring: plugin-registry unreachable");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("surfaces the real parse error for a file that isn't valid JSON", async () => {
    renderPanel([bundle()]);

    const input = screen.getByLabelText("Import bundle state from a JSON file");
    fireEvent.change(input, { target: { files: [fakeFile("not json")] } });

    // JSON.parse's own SyntaxError message -- it IS an Error instance, so the
    // component's "Could not read that file..." fallback (for a non-Error
    // throw) is never reached on this path; asserting the real message
    // catches a regression that swallowed it into the generic fallback.
    await screen.findByText(/is not valid JSON/);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("is admin-only: a non-admin can't import, and is told why", async () => {
    renderPanel([bundle({ name: "monitoring", enabled: false })], false);

    const input = screen.getByLabelText("Import bundle state from a JSON file");
    expect(input.hasAttribute("disabled")).toBe(true);
    expect(describedBy(input)).toBe("Only an admin can import bundle state.");

    // Even if a change event slips through, nothing is read, previewed or sent.
    importFile({ monitoring: { enabled: true } });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
