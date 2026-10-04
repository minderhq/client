import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { InstallStateBadge, StatusBadge } from "./StatusBadge";

afterEach(cleanup);

describe("StatusBadge", () => {
  it("renders text + an aria-hidden icon, never an emoji", () => {
    const { container } = render(<StatusBadge icon="star" label="Featured" />);
    const badge = container.firstChild as HTMLElement;

    expect(badge.textContent).toBe("Featured");
    expect(badge.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(badge.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("adds a visually-hidden qualifier when given one", () => {
    const { container } = render(
      <StatusBadge icon="check" label="Enabled" tone="success" srPrefix="Your install" />,
    );
    const badge = container.firstChild as HTMLElement;

    expect(badge.textContent).toBe("Your install: Enabled");
    expect(badge.querySelector(".sr-only")?.textContent).toBe("Your install: ");
    expect(badge.className).toContain("bg-green-100");
  });

  it("carries exactly one background colour, so a tone never loses to the neutral grey", () => {
    const { container } = render(<StatusBadge icon="warning" label="Inactive" tone="warn" />);
    const bg = (container.firstChild as HTMLElement).className
      .split(/\s+/)
      .filter((c) => /^bg-/.test(c));

    expect(bg).toEqual(["bg-amber-100"]);
  });

  it("words the caller's install state the same everywhere it appears", () => {
    const { container, rerender } = render(<InstallStateBadge enabled />);
    expect(container.textContent).toBe("Your install: Enabled");
    rerender(<InstallStateBadge enabled={false} />);
    expect(container.textContent).toBe("Your install: Disabled");
  });
});
