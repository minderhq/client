import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Sidebar } from "./Sidebar";

// Mutable per test (like AvailablePluginsPage.test.tsx's mockAuth) so both
// the non-admin (default) and admin (Review Queue visible) paths are covered.
let mockAuth = { role: "" };
vi.mock("../lib/auth", () => ({
  useAuth: () => mockAuth,
}));

let mockBilling = true;
vi.mock("../lib/useBillingAccess", () => ({
  useBillingAccess: () => mockBilling,
}));

describe("Sidebar", () => {
  beforeEach(() => {
    mockAuth = { role: "" };
    mockBilling = true;
  });

  it("opens Billing & licenses on Billing only for callers who may view billing (#64)", () => {
    const { unmount } = render(
      <MemoryRouter>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    expect(
      screen.getByText("Billing & licenses").closest("a")?.getAttribute("href"),
    ).toBe("/billing");
    unmount();
    // Without billing access the entry stays (Licenses is open to everyone)
    // but skips the Billing page the caller can't see.
    mockBilling = false;
    render(
      <MemoryRouter>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    expect(
      screen.getByText("Billing & licenses").closest("a")?.getAttribute("href"),
    ).toBe("/billing/licenses");
  });
  afterEach(cleanup);

  it("links the wordmark to home and every section's nav items to their routes", () => {
    render(
      <MemoryRouter>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );

    expect(screen.getByText("Minder").closest("a")?.getAttribute("href")).toBe("/");
    expect(
      screen.getByText("Knowledge Bases").closest("a")?.getAttribute("href"),
    ).toBe("/rag");
    expect(
      screen.getByText("Pipelines").closest("a")?.getAttribute("href"),
    ).toBe("/rag/pipelines");
    expect(
      screen.getByText("Discover").closest("a")?.getAttribute("href"),
    ).toBe("/marketplace/discover/plugins");
    expect(
      screen.getByText("Installed").closest("a")?.getAttribute("href"),
    ).toBe("/marketplace/installed/plugins");
    expect(
      screen.getByText("Publish").closest("a")?.getAttribute("href"),
    ).toBe("/marketplace/publish/submissions");
    expect(screen.getByText("Models").closest("a")?.getAttribute("href")).toBe(
      "/platform",
    );
  });

  it("renders every section label", () => {
    render(
      <MemoryRouter>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );

    for (const label of ["Knowledge", "Marketplace", "Platform", "Organization"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("calls onNavigate when a nav link is clicked", () => {
    const onNavigate = vi.fn();
    render(
      <MemoryRouter>
        <Sidebar open={true} onNavigate={onNavigate} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("Pipelines"));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("calls onNavigate when the wordmark is clicked", () => {
    const onNavigate = vi.fn();
    render(
      <MemoryRouter>
        <Sidebar open={true} onNavigate={onNavigate} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("Minder"));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("translates on/off screen based on the open prop", () => {
    const { rerender } = render(
      <MemoryRouter>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Minder").closest("aside")?.className).toContain(
      "-translate-x-full",
    );

    rerender(
      <MemoryRouter>
        <Sidebar open={true} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Minder").closest("aside")?.className).toContain(
      "translate-x-0",
    );
  });

  it("marks the active route's link distinctly from inactive ones", () => {
    render(
      <MemoryRouter initialEntries={["/rag/pipelines"]}>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );

    expect(screen.getByText("Pipelines").className).toContain("bg-indigo-50");
    expect(screen.getByText("Knowledge Bases").className).not.toContain(
      "bg-indigo-50",
    );
  });

  it("shows one Marketplace section of Discover / Installed / Publish (#2197)", () => {
    render(
      <MemoryRouter>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );

    const marketplace = screen.getByRole("group", { name: "Marketplace" });
    expect(
      within(marketplace).getAllByRole("link").map((a) => a.textContent),
    ).toEqual(["Discover", "Installed", "Publish"]);
    // The old per-type stores and their tabs are gone from the sidebar.
    for (const old of ["Plugins", "AI Tools", "Bundles", "Submit a Plugin", "Review Queue"]) {
      expect(screen.queryByText(old)).toBeNull();
    }
    expect(
      within(screen.getByRole("group", { name: "Platform" })).queryByText(/bundles/i),
    ).toBeNull();
  });

  it("shows Installation settings › MindHub & sources to an admin only", () => {
    const { unmount } = render(
      <MemoryRouter>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    // A non-admin sees no Installation settings section at all, not an empty heading.
    expect(screen.queryByRole("group", { name: "Installation settings" })).toBeNull();
    expect(screen.queryByText("MindHub & sources")).toBeNull();
    unmount();

    mockAuth = { role: "admin" };
    render(
      <MemoryRouter>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    const settings = screen.getByRole("group", { name: "Installation settings" });
    expect(
      within(settings).getByText("MindHub & sources").closest("a")?.getAttribute("href"),
    ).toBe("/settings/sources");
  });

  /** Every sidebar link that carries aria-current, as label → value. */
  function currentRows(): Record<string, string | null> {
    const nav = screen.getByRole("navigation", { name: "Main" });
    return Object.fromEntries(
      within(nav)
        .getAllByRole("link")
        .filter((a) => a.hasAttribute("aria-current"))
        .map((a) => [a.textContent, a.getAttribute("aria-current")]),
    );
  }

  it("marks a plain entry on its own route as the current page", () => {
    render(
      <MemoryRouter initialEntries={["/rag/pipelines"]}>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    expect(currentRows()).toEqual({ Pipelines: "page" });
  });

  it("marks a tabbed entry as the current section, not the page (the tab is the page)", () => {
    for (const path of ["/marketplace/installed/ai-tools", "/marketplace/installed/plugins"]) {
      const { unmount } = render(
        <MemoryRouter initialEntries={[path]}>
          <Sidebar open={false} onNavigate={() => {}} />
        </MemoryRouter>,
      );
      expect(currentRows()).toEqual({ Installed: "true" });
      unmount();
    }
  });

  it("marks an entry 'page' when the caller sees no tab strip for it", () => {
    // A non-admin sees only Submissions in Publish, so no tab strip renders
    // and the sidebar row is the only current-page marker.
    render(
      <MemoryRouter initialEntries={["/marketplace/publish/submissions"]}>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    expect(currentRows()).toEqual({ Publish: "page" });
  });

  it("marks MindHub & sources 'page' on the list and 'true' on a repository's detail", () => {
    mockAuth = { role: "admin" };
    const { unmount } = render(
      <MemoryRouter initialEntries={["/settings/sources"]}>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    expect(currentRows()).toEqual({ "MindHub & sources": "page" });
    unmount();
    render(
      <MemoryRouter initialEntries={["/settings/sources/r1"]}>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    expect(currentRows()).toEqual({ "MindHub & sources": "true" });
  });


  it("hides admin-only Members from a non-admin but shows it to an admin", () => {
    const { unmount } = render(
      <MemoryRouter>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByText("All Users")).toBeNull();
    unmount();

    mockAuth = { role: "admin" };
    render(
      <MemoryRouter>
        <Sidebar open={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    expect(
      screen.getByText("All Users").closest("a")?.getAttribute("href"),
    ).toBe("/platform/users");
  });
});
