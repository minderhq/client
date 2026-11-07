import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setLocale } from "../i18n";
import { OutsideContentMarker, TaintNotice } from "./TaintNotice";

beforeEach(() => setLocale("tr"));
afterEach(() => {
  cleanup();
  setLocale("en");
});

describe("TaintNotice", () => {
  it("shows the 'after reading X' line for a tainted item", () => {
    render(
      <TaintNotice
        item={{ tainted: true, taint_sources: ["kb:ask_contracts"] }}
        names={{ ask_contracts: "Sözleşmeler" }}
      />,
    );
    expect(
      screen.getByText("Bu istek, “Sözleşmeler” bilgi tabanından gelen bir metinden sonra geldi."),
    ).toBeTruthy();
  });

  it("renders nothing for a clean item", () => {
    const { container } = render(<TaintNotice item={{ tainted: false, taint_sources: [], data_policy_risk: null }} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the local-only risk, even on an untainted item", () => {
    render(<TaintNotice item={{ tainted: false, taint_sources: [], data_policy_risk: "local_only" }} />);
    expect(screen.getByText(/Yerel tutulması gereken veri okunduktan sonra/)).toBeTruthy();
    expect(screen.queryByText(/sonra geldi/)).toBeNull();
  });
});

describe("OutsideContentMarker", () => {
  it("stays shown on later clean turns once a turn was tainted", () => {
    const { rerender } = render(<OutsideContentMarker tainted={false} />);
    expect(screen.queryByText("Dış içerik içeriyor")).toBeNull();

    rerender(<OutsideContentMarker tainted />);
    expect(screen.getByText("Dış içerik içeriyor")).toBeTruthy();

    rerender(<OutsideContentMarker tainted={false} />);
    rerender(<OutsideContentMarker tainted={false} />);
    expect(screen.getByText("Dış içerik içeriyor")).toBeTruthy();
  });

  it("starts clean for a new conversation", () => {
    const { rerender } = render(<OutsideContentMarker key="a" tainted />);
    rerender(<OutsideContentMarker key="b" tainted={false} />);
    expect(screen.queryByText("Dış içerik içeriyor")).toBeNull();
  });
});
