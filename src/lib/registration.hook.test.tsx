import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useRegistrationMode } from "./registration";

const apiFetch = vi.fn();
vi.mock("./api", async () => ({
  ...(await vi.importActual<typeof import("./api")>("./api")),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

describe("useRegistrationMode", () => {
  afterEach(() => apiFetch.mockReset());

  it("is loading from the very first render, then reports the mode", async () => {
    apiFetch.mockResolvedValue({ registration_mode: "invite" });
    const { result } = renderHook(() => useRegistrationMode());
    expect(result.current).toEqual({ mode: null, loading: true });
    await waitFor(() => expect(result.current).toEqual({ mode: "invite", loading: false }));
    expect(apiFetch).toHaveBeenCalledWith("/v1/auth/capabilities", expect.anything());
  });

  it("settles on unknown when the lookup fails", async () => {
    apiFetch.mockRejectedValue(new Error("Request failed (404)"));
    const { result } = renderHook(() => useRegistrationMode());
    await waitFor(() => expect(result.current).toEqual({ mode: null, loading: false }));
  });

  it("fetches nothing when disabled", async () => {
    const { result } = renderHook(() => useRegistrationMode({ enabled: false }));
    expect(result.current).toEqual({ mode: null, loading: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
