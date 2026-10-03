import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { clearUrlFragment, readFragmentToken, useNoReferrerMeta } from "./tokenPage";

function referrerMetas(): HTMLMetaElement[] {
  return [...document.head.querySelectorAll<HTMLMetaElement>('meta[name="referrer"]')];
}

describe("readFragmentToken", () => {
  it("reads the token parameter of the fragment", () => {
    expect(readFragmentToken("#token=mpr_abc-DEF_123")).toBe("mpr_abc-DEF_123");
    expect(readFragmentToken("#lang=tr&token=mpr_x&y=1")).toBe("mpr_x");
  });

  it("percent-decodes the value", () => {
    expect(readFragmentToken("#token=a%2Bb")).toBe("a+b");
  });

  it("anchors the parameter name", () => {
    expect(readFragmentToken("#xtoken=mpr_x")).toBeNull();
    expect(readFragmentToken("#a=token=mpr_x")).toBeNull();
  });

  it("treats a missing, empty, malformed or oversized token as no token", () => {
    expect(readFragmentToken("")).toBeNull();
    expect(readFragmentToken("#")).toBeNull();
    expect(readFragmentToken("#token=")).toBeNull();
    expect(readFragmentToken("#token=%20%20")).toBeNull();
    expect(readFragmentToken("#token=%E0%A4%A")).toBeNull();
    expect(readFragmentToken(`#token=${"a".repeat(128)}`)).toBe("a".repeat(128));
    expect(readFragmentToken(`#token=${"a".repeat(129)}`)).toBeNull();
  });
});

describe("clearUrlFragment", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("drops the fragment and keeps the path, query and history state", () => {
    const state = { usr: null, key: "k1", idx: 3 };
    window.history.replaceState(state, "", "/reset-password?x=1#token=secret");
    const before = window.history.length;
    clearUrlFragment();
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("secret");
    expect(window.location.pathname).toBe("/reset-password");
    expect(window.location.search).toBe("?x=1");
    expect(window.history.state).toEqual(state);
    // Replaced, not pushed: Back can't return to the URL with the token.
    expect(window.history.length).toBe(before);
  });

  it("does nothing without a fragment", () => {
    window.history.replaceState(null, "", "/reset-password");
    clearUrlFragment();
    expect(window.location.pathname).toBe("/reset-password");
  });
});

describe("useNoReferrerMeta", () => {
  afterEach(() => {
    cleanup();
    referrerMetas().forEach((m) => m.remove());
  });

  it("adds a no-referrer meta while mounted and removes it on unmount", () => {
    const { unmount } = renderHook(() => useNoReferrerMeta());
    expect(referrerMetas().map((m) => m.content)).toEqual(["no-referrer"]);
    unmount();
    expect(referrerMetas()).toEqual([]);
  });

  it("restores an existing referrer meta on unmount", () => {
    const meta = document.createElement("meta");
    meta.name = "referrer";
    meta.content = "strict-origin-when-cross-origin";
    document.head.appendChild(meta);
    const { unmount } = renderHook(() => useNoReferrerMeta());
    expect(referrerMetas().map((m) => m.content)).toEqual(["no-referrer"]);
    unmount();
    expect(referrerMetas().map((m) => m.content)).toEqual([
      "strict-origin-when-cross-origin",
    ]);
  });
});
