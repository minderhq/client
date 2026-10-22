import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QueryResultCard, type QueryResponse } from "../pages/RagPipelinesPage";
import type { RetrievedSource } from "../lib/citations";

const sources: RetrievedSource[] = [
  {
    text: "Refunds are allowed within 30 days of purchase.",
    source: "handbook.pdf",
    score: 0.91,
    chunk_id: "chunk-a",
    chunk_index: 4,
    document_id: "doc-1",
    page: 3,
    char_start: 1200,
    char_end: 1248,
  },
  {
    text: "Store credit is offered after 30 days.",
    source: "faq.docx",
    score: null,
    chunk_id: "chunk-b",
    chunk_index: 0,
    document_id: "doc-2",
    page: null,
  },
];

function response(overrides: Partial<QueryResponse> = {}): QueryResponse {
  return {
    answer: "Refunds take 30 days [1][2]. After that, credit [2]. Code: `a[1]` and [9].",
    sources,
    citations: [
      { marker: 1, source_index: 0, chunk_id: "chunk-a" },
      { marker: 2, source_index: 1, chunk_id: "chunk-b" },
    ],
    confidence: 0.9,
    model_used: "llama3",
    method: "standard",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("citation chips", () => {
  it("renders listed markers as labelled superscript buttons, the rest as text", () => {
    const { container } = render(<QueryResultCard response={response()} />);
    const chips = screen.getAllByRole("button", { name: /^Source \d/ });
    expect(chips.map((c) => c.textContent)).toEqual(["1", "2", "2"]);
    expect(chips[0].closest("sup")).toBeTruthy();
    expect(chips[0].getAttribute("aria-label")).toBe("Source 1: handbook.pdf, page 3");
    expect(chips[1].getAttribute("aria-label")).toBe("Source 2: faq.docx");
    // Code span and the unknown marker stay literal.
    const answer = container.querySelector("p.whitespace-pre-wrap")!;
    expect(answer.textContent).toContain("`a[1]` and [9].");
  });

  it("points each chip at its source card", () => {
    render(<QueryResultCard response={response()} />);
    const chip = screen.getAllByRole("button", { name: /^Source 1/ })[0];
    const target = document.getElementById(chip.getAttribute("aria-controls")!);
    expect(target?.getAttribute("aria-label")).toBe("Source 1: handbook.pdf");
  });

  it("scrolls to, focuses and highlights the source card on click", () => {
    // jsdom has no layout, so no scrollIntoView of its own.
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<QueryResultCard response={response()} />);
    const card = screen.getByRole("listitem", { name: "Source 2: faq.docx" });
    expect(card.getAttribute("data-highlighted")).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "Source 2: faq.docx" })[0]);

    expect(card.getAttribute("data-highlighted")).toBe("true");
    expect(document.activeElement).toBe(card);
    expect(scrollIntoView).toHaveBeenCalled();
    expect(
      screen.getByRole("listitem", { name: "Source 1: handbook.pdf" }).getAttribute(
        "data-highlighted",
      ),
    ).toBeNull();
    expect(
      screen.getAllByRole("button", { name: "Source 2: faq.docx" })[0].getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
  });

  it("shows the filename, a page badge only when page is set, and the snippet", () => {
    render(<QueryResultCard response={response()} />);
    const first = screen.getByRole("listitem", { name: "Source 1: handbook.pdf" });
    expect(within(first).getByText("page 3")).toBeTruthy();
    expect(within(first).getByText(sources[0].text)).toBeTruthy();
    const second = screen.getByRole("listitem", { name: "Source 2: faq.docx" });
    expect(within(second).queryByText(/^page /)).toBeNull();
    expect(within(second).queryByText(/score/)).toBeNull(); // score: null
  });

  it("shows the full passage of a highlighted long source", () => {
    const long = "y".repeat(300);
    render(
      <QueryResultCard
        response={response({
          answer: "Long [1].",
          sources: [{ text: long, source: "long.pdf" }],
          citations: [{ marker: 1, source_index: 0 }],
        })}
      />,
    );
    expect(screen.queryByText(long)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Source 1: long.pdf" }));
    expect(screen.getByText(long)).toBeTruthy();
  });

  it("renders plain text when citations are empty or the card is compact", () => {
    const { rerender } = render(<QueryResultCard response={response({ citations: [] })} />);
    expect(screen.queryAllByRole("button", { name: /^Source \d/ })).toHaveLength(0);
    rerender(<QueryResultCard response={response()} compact />);
    expect(screen.queryAllByRole("button", { name: /^Source \d/ })).toHaveLength(0);
    expect(screen.getByText(/Refunds take 30 days \[1\]\[2\]/)).toBeTruthy();
  });

  it("handles the public chat shape (no document_id / chunk_id)", () => {
    const publicSources: RetrievedSource[] = [
      { text: "Opening hours are 9 to 5.", source: "hours.pdf", score: 0.7, page: 1 },
    ];
    render(
      <QueryResultCard
        response={response({
          answer: "We open at 9 [1].",
          sources: publicSources,
          citations: [{ marker: 1, source_index: 0 }],
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Source 1: hours.pdf, page 1" }));
    const card = screen.getByRole("listitem", { name: "Source 1: hours.pdf" });
    expect(card.getAttribute("data-highlighted")).toBe("true");
    expect(within(card).queryByRole("button", { name: /open passage/i })).toBeNull();
  });
});

// Defence in depth: the server already strips external images from answers,
// but the client must never turn assistant text into fetchable elements.
describe("assistant content stays inert text", () => {
  const hostile = [
    "Look ![x](https://example.net/a.png?q=1) here [1].",
    "Local ![y](/logo.svg) too.",
    "[click](https://example.net/phish) and <https://example.net/auto>",
    '<img src="https://example.net/b.png" onerror="alert(1)"> <a href="https://example.net">a</a>',
    "<script>alert(1)</script>",
  ].join("\n");

  it.each([
    ["with citation chips", {}],
    ["as plain text", { compact: true }],
  ])("renders no img, link or raw HTML element %s", (_label, props) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { container } = render(
      <QueryResultCard response={response({ answer: hostile })} {...props} />,
    );
    const answer = container.querySelector("p.whitespace-pre-wrap")!;
    expect(answer.querySelector("img, a, script, iframe, source, video, audio")).toBeNull();
    expect(container.querySelector('img[src^="http"], [src*="example.net"], [href*="example.net"]')).toBeNull();
    // The markdown and HTML show up literally, so nothing is hidden from the reader.
    expect(answer.textContent).toContain("![x](https://example.net/a.png?q=1)");
    expect(answer.textContent).toContain('<img src="https://example.net/b.png"');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
