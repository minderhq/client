import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { type SourceKind, SOURCE_META } from "../lib/pluginSource";
import { SourceBadge } from "./SourceBadge";

afterEach(cleanup);

const CASES: [SourceKind, string][] = [
  ["first_party", "First-party"],
  ["private_git", "Private git"],
  ["submitted", "Submitted on this instance"],
  ["mindhub", "MindHub"],
];

describe("SourceBadge", () => {
  it.each(CASES)("renders %s as text + icon with an accessible name", (kind, label) => {
    const { container } = render(<SourceBadge source={kind} />);
    const badge = container.querySelector(`[data-source="${kind}"]`) as HTMLElement;

    expect(badge).not.toBeNull();
    // The accessible name is the text content: a visually-hidden "Source:"
    // prefix + the visible label (the icon is aria-hidden).
    expect(badge.textContent).toBe(`Source: ${label}`);
    const icon = badge.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon!.getAttribute("aria-hidden")).toBe("true");
    expect(badge.querySelector(".sr-only")?.textContent).toBe("Source: ");
    // tooltip explains what the source means
    expect(badge.getAttribute("title")).toBe(SOURCE_META[kind].description);
  });

  it("gives every variant a distinct label (never colour alone)", () => {
    const labels = Object.values(SOURCE_META).map((m) => m.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("renders nothing for an unclassified plugin", () => {
    const { container } = render(<SourceBadge source={null} />);
    expect(container.innerHTML).toBe("");
  });
});
