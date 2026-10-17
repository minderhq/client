import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "./locale";
import { useI18n } from "./useI18n";

function Greeting({ count }: { count: number }) {
  const { t, plural, rich } = useI18n();
  return (
    <div>
      <button type="button">{t("common.retry")}</button>
      <p data-testid="count">{plural("common.results", count)}</p>
      <p data-testid="rich">
        {rich("auth.reset.signedInAs", { username: <strong>alice</strong> })}
      </p>
    </div>
  );
}

// jsdom under some Node versions has no working `localStorage` global (see
// lib/theme.test.ts): use a Map-backed stand-in.
function stubLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  });
}

beforeEach(stubLocalStorage);

afterEach(() => {
  cleanup();
  setLocale("en");
  vi.unstubAllGlobals();
});

describe("useI18n", () => {
  it("re-renders every user in the new language when it changes", () => {
    render(<Greeting count={3} />);
    expect(screen.getByRole("button").textContent).toBe("Retry");
    expect(screen.getByTestId("count").textContent).toBe("3 results");

    act(() => setLocale("tr"));
    expect(screen.getByRole("button").textContent).toBe("Yeniden dene");
    expect(screen.getByTestId("count").textContent).toBe("3 sonuç");
    expect(document.documentElement.lang).toBe("tr");
  });

  it("interpolates React nodes with rich()", () => {
    render(<Greeting count={1} />);
    const rich = screen.getByTestId("rich");
    expect(rich.textContent).toBe("You're signed in as alice.");
    expect(rich.querySelector("strong")?.textContent).toBe("alice");

    act(() => setLocale("tr"));
    expect(rich.textContent).toBe("alice olarak oturum açtınız.");
    expect(rich.querySelector("strong")?.textContent).toBe("alice");
  });
});
