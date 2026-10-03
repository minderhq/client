import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ExternalLink } from "./ExternalLink";

describe("ExternalLink", () => {
  afterEach(cleanup);

  it("renders an http(s) URL as a new-tab link that can't reach back", () => {
    render(<ExternalLink href="https://github.com/acme/weather-plus" />);

    const link = screen.getByRole("link", {
      name: "https://github.com/acme/weather-plus (opens in a new tab)",
    });
    expect(link.getAttribute("href")).toBe("https://github.com/acme/weather-plus");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("uses custom link text when given", () => {
    render(<ExternalLink href="https://img.example.com/1.png">Screenshot 1</ExternalLink>);
    expect(screen.getByRole("link", { name: "Screenshot 1 (opens in a new tab)" })).toBeTruthy();
  });

  it.each(["javascript:alert(1)", "data:text/html,<b>x</b>", "/relative", "vbscript:x"])(
    "shows %j as text, never as a link",
    (href) => {
      const { container } = render(<ExternalLink href={href} />);
      expect(screen.queryByRole("link")).toBeNull();
      expect(container.querySelector("a")).toBeNull();
      expect(screen.getByText(href)).toBeTruthy();
      expect(screen.getByText(/not linked: only http and https URLs open/)).toBeTruthy();
    },
  );

  it("renders nothing for an empty value", () => {
    const { container } = render(<ExternalLink href={null} />);
    expect(container.textContent).toBe("");
  });
});
