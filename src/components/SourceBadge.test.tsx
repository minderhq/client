import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { type SourceKind, SOURCE_META } from "../lib/pluginSource";
import { SourceBadge, SourceLegend } from "./SourceBadge";

afterEach(cleanup);

const CASES: [SourceKind, string][] = [
  ["first_party", "First-party"],
  ["private_git", "Private git"],
  ["submitted", "Submitted on this instance"],
  ["mindhub", "MindHub"],
];

describe("SourceBadge", () => {
  it.each(CASES)("gives %s exactly one background colour (its own tone, never the grey)", (kind) => {
    const { container } = render(<SourceBadge source={kind} />);
    const badge = container.querySelector(`[data-source="${kind}"]`) as HTMLElement;
    const bg = badge.className.split(/\s+/).filter((c) => /^bg-/.test(c));

    expect(bg).toEqual(SOURCE_META[kind].toneClass.split(/\s+/).filter((c) => /^bg-/.test(c)));
  });

  it.each(CASES)("renders %s as text + icon with an accessible name", (kind, label) => {
    const { container } = render(<SourceBadge source={kind} />);
    const badge = container.querySelector(`[data-source="${kind}"]`) as HTMLElement;

    expect(badge).not.toBeNull();
    // What a screen reader reads: a visually-hidden "Source:" prefix, the
    // visible label (the icon is aria-hidden), then the meaning as
    // visually-hidden text -- not only in a hover-only `title`.
    const description = SOURCE_META[kind].description;
    expect(badge.textContent).toBe(`Source: ${label} (${description})`);
    const hidden = Array.from(badge.querySelectorAll(".sr-only")).map((n) => n.textContent);
    expect(hidden).toEqual(["Source: ", ` (${description})`]);
    const icon = badge.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon!.getAttribute("aria-hidden")).toBe("true");
    // tooltip explains what the source means
    expect(badge.getAttribute("title")).toBe(SOURCE_META[kind].description);
  });

  it("gives every variant a distinct label (never colour alone)", () => {
    const labels = Object.values(SOURCE_META).map((m) => m.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("shows the visible label without the description (that stays visually hidden)", () => {
    const { container } = render(<SourceBadge source="first_party" />);
    const visible = Array.from(container.querySelector("[data-source]")!.childNodes)
      .filter((n) => !(n instanceof HTMLElement && n.classList.contains("sr-only")))
      .map((n) => n.textContent)
      .join("");
    expect(visible).toBe("First-party");
  });

  it("renders nothing for an unclassified plugin", () => {
    const { container } = render(<SourceBadge source={null} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("SourceLegend", () => {
  it("is a keyboard/touch-operable disclosure explaining each offered source", () => {
    render(<SourceLegend />);
    const summary = screen.getByText("What do the source badges mean?");
    const details = summary.closest("details")!;
    expect(details.open).toBe(false);

    fireEvent.click(summary);
    expect(details.open).toBe(true);

    const terms = Array.from(details.querySelectorAll("dt")).map((dt) => dt.textContent);
    expect(terms).toEqual(["First-party", "Private git", "Submitted on this instance"]);
    for (const kind of ["first_party", "private_git", "submitted"] as const) {
      expect(screen.getByText(SOURCE_META[kind].description)).toBeTruthy();
    }
    // MindHub is reserved for Phase 2 and not explained until it can appear.
    expect(screen.queryByText("MindHub")).toBeNull();
  });

  it("can list a custom set of sources", () => {
    render(<SourceLegend kinds={["mindhub"]} />);
    expect(screen.getByText("MindHub")).toBeTruthy();
  });
});
