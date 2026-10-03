import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LoadError } from "./LoadError";

afterEach(cleanup);

describe("LoadError", () => {
  it("announces a blocking failure as an alert with the reason and a named Retry", () => {
    const onRetry = vi.fn();
    render(
      <LoadError
        title="Couldn't load the plugin catalog."
        message="Service unavailable"
        what="the plugin catalog"
        onRetry={onRetry}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Couldn't load the plugin catalog.");
    expect(alert.textContent).toContain("Service unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry loading the plugin catalog" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps a quiet notice polite (status, not alert) so the main list stays the focus", () => {
    render(
      <LoadError
        quiet
        title="Featured plugins couldn't be loaded."
        what="featured plugins"
        onRetry={vi.fn()}
      />,
    );

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain(
      "Featured plugins couldn't be loaded.",
    );
    // The visible text is "Retry"; the accessible name starts with it.
    const button = screen.getByRole("button", { name: "Retry loading featured plugins" });
    expect(button.textContent).toBe("Retry loading featured plugins");
    expect(button.querySelector(".sr-only")?.textContent).toBe(" loading featured plugins");
  });
});
