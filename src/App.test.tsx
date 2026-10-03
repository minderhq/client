import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { TOKEN_KEY } from "./lib/api";
import { MUST_CHANGE_PASSWORD_KEY } from "./lib/auth";

// Every page fetches on mount. A bare `{}` stub trips a real (if low-risk --
// the backend always sends these keys) defensive-coding gap in HealthStrip,
// which does `services.data.length` after `=== null` guard that a resolved
// `undefined` `.services` key slips past -- out of scope here, so instead the
// stub carries every array/count key any mounted page's fetch destructures,
// all zero-length/zero, which every page already renders as a normal empty
// state rather than an error.
vi.mock("./lib/api", async () => {
  const actual = await vi.importActual<typeof import("./lib/api")>("./lib/api");
  const safeEmptyResponse = {
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
  };
  return { ...actual, apiFetch: vi.fn().mockResolvedValue(safeEmptyResponse) };
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("App", () => {
  afterEach(() => {
    sessionStorage.clear();
    cleanup();
  });

  it("renders the home dashboard at /", () => {
    renderAt("/");
    expect(screen.getByRole("heading", { name: "Minder" })).toBeTruthy();
  });

  it("renders the login page at /login", () => {
    renderAt("/login");
    expect(screen.getByRole("heading", { name: "Log in" })).toBeTruthy();
  });

  it("renders the forgot-password page at /forgot-password", () => {
    renderAt("/forgot-password");
    expect(screen.getByRole("heading", { name: "Reset your password" })).toBeTruthy();
  });

  it("renders the reset-password page at /reset-password", () => {
    renderAt("/reset-password");
    // No #token in a MemoryRouter test, so the page offers a new link.
    expect(screen.getByRole("heading", { name: "Reset your password" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send me a new link" })).toBeTruthy();
  });

  it("opens a reset link in a tab that must change its password (#2138)", () => {
    // A signed-in session flagged must_change_password: the forced-change
    // gate covers the app's routes, but not the public recovery routes.
    const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "");
    const now = Math.floor(Date.now() / 1000);
    sessionStorage.setItem(
      TOKEN_KEY,
      `${b64({ alg: "HS256" })}.${b64({ sub: "7", username: "alice", iat: now, exp: now + 3600 })}.sig`,
    );
    sessionStorage.setItem(MUST_CHANGE_PASSWORD_KEY, "1");
    window.history.replaceState(null, "", "/reset-password#token=mpr_gated-tab-token");
    try {
      renderAt("/reset-password");
      expect(screen.getByRole("heading", { name: "Choose a new password" })).toBeTruthy();
      expect(screen.queryByText(/An administrator reset your password/)).toBeNull();
      expect(window.location.hash).toBe("");
      cleanup();
      // Every other route is still gated.
      renderAt("/settings");
      expect(screen.getByText(/An administrator reset your password/)).toBeTruthy();
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("redirects an unmatched path home", () => {
    renderAt("/this-route-does-not-exist");
    expect(screen.getByRole("heading", { name: "Minder" })).toBeTruthy();
  });

  it("redirects the old /marketplace path to Available Plugins", () => {
    renderAt("/marketplace");
    expect(screen.getByRole("heading", { name: "Available Plugins" })).toBeTruthy();
  });

  it("redirects the old /platform/bundles path to Available Bundles", () => {
    renderAt("/platform/bundles");
    expect(screen.getByRole("heading", { name: "Available Bundles" })).toBeTruthy();
  });

  it("redirects the section-index /ai-tools path to the AI Tool Catalog", () => {
    renderAt("/ai-tools");
    expect(screen.getByRole("heading", { name: "AI Tool Catalog" })).toBeTruthy();
  });

  it("redirects the old /knowledge-bases path to the RAG section", () => {
    renderAt("/knowledge-bases");
    expect(screen.getByRole("heading", { name: "Knowledge Bases" })).toBeTruthy();
  });

  it("shows the sidebar and a logged-out UserMenu together", () => {
    renderAt("/");
    expect(screen.getByText("Log in").closest("a")?.getAttribute("href")).toBe(
      "/login",
    );
    expect(screen.getAllByText("Minder").length).toBeGreaterThan(0);
  });

  it("opens the mobile sidebar overlay via the hamburger button, and closes it on overlay click", () => {
    const { container } = renderAt("/");

    expect(container.querySelector(".fixed.inset-0.z-30")).toBeNull();

    fireEvent.click(screen.getByLabelText("Toggle navigation"));
    const overlay = container.querySelector(".fixed.inset-0.z-30");
    expect(overlay).not.toBeNull();

    fireEvent.click(overlay!);
    expect(container.querySelector(".fixed.inset-0.z-30")).toBeNull();
  });

  it("closes the mobile sidebar overlay when a nav link is clicked", () => {
    const { container } = renderAt("/");

    fireEvent.click(screen.getByLabelText("Toggle navigation"));
    expect(container.querySelector(".fixed.inset-0.z-30")).not.toBeNull();

    const sidebar = container.querySelector("aside")!;
    fireEvent.click(within(sidebar).getByText("Pipelines"));
    expect(container.querySelector(".fixed.inset-0.z-30")).toBeNull();
  });
});
