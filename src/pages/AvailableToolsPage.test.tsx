import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AvailableToolsPage } from "./AvailableToolsPage";

const apiFetch = vi.fn();

vi.mock("../lib/api", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => apiFetch(...args),
  };
});

function tool(overrides: {
  id?: string;
  tool_name?: string;
  active?: boolean;
  description?: string | null;
} = {}) {
  return {
    id: overrides.id ?? "t1",
    plugin_id: "p1",
    plugin_name: "weather",
    plugin_display_name: "Weather",
    tool_name: overrides.tool_name ?? "get_weather",
    type: "function",
    description:
      "description" in overrides ? overrides.description! : "Get the current weather",
    endpoint: "/v1/plugins/weather/actions/get_weather",
    method: "GET",
    required_tier: "free",
    active: overrides.active ?? true,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AvailableToolsPage />
    </MemoryRouter>,
  );
}

describe("AvailableToolsPage", () => {
  afterEach(() => {
    cleanup();
    apiFetch.mockReset();
  });

  it("renders the Discover AI tools heading and points to Installed AI tools", async () => {
    apiFetch.mockResolvedValue({ tools: [], count: 0, total: 0, limit: 20, offset: 0 });
    renderPage();

    expect(screen.getByRole("heading", { name: "Discover AI tools" })).toBeTruthy();
    expect(
      screen.getAllByText("Installed AI tools")[0].closest("a")?.getAttribute("href"),
    ).toBe("/marketplace/installed/ai-tools");
  });

  it("shows an empty state when the catalog has no tools", async () => {
    apiFetch.mockResolvedValue({ tools: [], count: 0, total: 0, limit: 20, offset: 0 });
    renderPage();

    await screen.findByText("No AI tools in the catalog yet.");
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/marketplace/ai/tools?active_only=false&limit=20&offset=0",
    );
  });

  it("renders a card per catalog tool, including an inactive badge", async () => {
    apiFetch.mockResolvedValue({
      tools: [tool({ id: "t1" }), tool({ id: "t2", tool_name: "send_email", active: false })],
      count: 2,
      total: 2,
      limit: 20,
      offset: 0,
    });
    renderPage();

    await screen.findByText("get_weather");
    expect(screen.getByText("send_email")).toBeTruthy();
    const badge = screen.getByText("Inactive");
    expect(badge.getAttribute("data-status-badge")).toBe("Inactive");
    expect(badge.querySelector("svg")).toBeTruthy();
    // Badges sit beside the title (h3 under the catalog's h2), not inside it.
    expect(screen.getByRole("heading", { level: 3, name: "send_email" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "AI tool catalog" })).toBeTruthy();
  });

  it("falls back to a placeholder when a tool has no description", async () => {
    apiFetch.mockResolvedValue({
      tools: [tool({ description: null })],
      count: 1,
      total: 1,
      limit: 20,
      offset: 0,
    });
    renderPage();

    await screen.findByText("No description provided.");
  });

  it("shows a Load more button when more results exist, and fetches the next page", async () => {
    apiFetch.mockResolvedValueOnce({
      tools: [tool({ id: "t1" })],
      count: 1,
      total: 2,
      limit: 20,
      offset: 0,
    });
    renderPage();
    await screen.findByText("get_weather");

    apiFetch.mockResolvedValueOnce({
      tools: [tool({ id: "t2", tool_name: "send_email" })],
      count: 1,
      total: 2,
      limit: 20,
      offset: 20,
    });
    fireEvent.click(screen.getByText("Load more"));

    await screen.findByText("send_email");
    expect(apiFetch).toHaveBeenLastCalledWith(
      "/v1/marketplace/ai/tools?active_only=false&limit=20&offset=20",
    );
  });

  it("does not show Load more once every result has loaded", async () => {
    apiFetch.mockResolvedValue({
      tools: [tool()],
      count: 1,
      total: 1,
      limit: 20,
      offset: 0,
    });
    renderPage();

    await screen.findByText("get_weather");
    expect(screen.queryByText("Load more")).toBeNull();
  });

  it("shows a skeleton, not the empty state, while the first page is loading", async () => {
    let resolve!: (v: unknown) => void;
    apiFetch.mockReturnValue(new Promise((r) => (resolve = r)));
    renderPage();

    expect(screen.getByTestId("card-list-skeleton")).toBeTruthy();
    expect(screen.getByText("Loading AI tools…")).toBeTruthy();
    expect(screen.queryByText("No AI tools in the catalog yet.")).toBeNull();

    resolve({ tools: [], count: 0, total: 0, limit: 20, offset: 0 });
    await screen.findByText("No AI tools in the catalog yet.");
    expect(screen.queryByTestId("card-list-skeleton")).toBeNull();
  });

  it("shows an error with Retry on failure -- not the empty state -- and recovers", async () => {
    apiFetch.mockRejectedValueOnce(new Error("network down"));
    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't load the AI tool catalog.");
    expect(alert.textContent).toContain("network down");
    expect(screen.queryByText("No AI tools in the catalog yet.")).toBeNull();

    apiFetch.mockResolvedValueOnce({ tools: [tool()], count: 1, total: 1, limit: 20, offset: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Retry loading the AI tool catalog" }));

    await screen.findByText("get_weather");
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
