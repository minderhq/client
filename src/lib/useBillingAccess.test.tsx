import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./api";
import { resetBillingAccessCache, useBillingAccess } from "./useBillingAccess";

const fetchSubscription = vi.fn();
vi.mock("./billing", () => ({
  fetchSubscription: (...args: unknown[]) => fetchSubscription(...args),
}));

let mockAuth = { token: "t", sessionKey: "u1:org-a" };
vi.mock("./auth", () => ({ useAuth: () => mockAuth }));
vi.mock("./useTokenRef", () => ({ useTokenRef: () => ({ current: mockAuth.token }) }));

describe("useBillingAccess (#64)", () => {
  beforeEach(() => {
    resetBillingAccessCache();
    fetchSubscription.mockReset();
    mockAuth = { token: "t", sessionKey: "u1:org-a" };
  });
  afterEach(cleanup);

  it("hides billing on an explicit 403", async () => {
    fetchSubscription.mockRejectedValue(new ApiError("forbidden", 403));
    const { result } = renderHook(() => useBillingAccess());
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("stays visible when allowed, and on any other failure", async () => {
    fetchSubscription.mockResolvedValue({ tier: "community" });
    const ok = renderHook(() => useBillingAccess());
    await waitFor(() => expect(fetchSubscription).toHaveBeenCalledTimes(1));
    expect(ok.result.current).toBe(true);
    cleanup();
    resetBillingAccessCache();
    fetchSubscription.mockRejectedValue(new ApiError("boom", 503));
    const failing = renderHook(() => useBillingAccess());
    await waitFor(() => expect(fetchSubscription).toHaveBeenCalledTimes(2));
    expect(failing.result.current).toBe(true);
  });

  it("asks once per session identity and again after an org switch", async () => {
    fetchSubscription.mockRejectedValue(new ApiError("forbidden", 403));
    const first = renderHook(() => useBillingAccess());
    await waitFor(() => expect(first.result.current).toBe(false));
    renderHook(() => useBillingAccess());
    expect(fetchSubscription).toHaveBeenCalledTimes(1);

    mockAuth = { token: "t2", sessionKey: "u1:org-b" };
    fetchSubscription.mockResolvedValue({ tier: "pro" });
    const switched = renderHook(() => useBillingAccess());
    await waitFor(() => expect(fetchSubscription).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(switched.result.current).toBe(true));
  });

  it("shares one in-flight request between every caller on a cold load", async () => {
    let resolve!: (v: unknown) => void;
    fetchSubscription.mockReturnValue(new Promise((r) => (resolve = r)));
    // Sidebar, PageTabs and the command palette mount together.
    const hooks = [1, 2, 3].map(() => renderHook(() => useBillingAccess()));
    expect(fetchSubscription).toHaveBeenCalledTimes(1);
    resolve({ tier: "pro" });
    for (const h of hooks) await waitFor(() => expect(h.result.current).toBe(true));
    expect(fetchSubscription).toHaveBeenCalledTimes(1);
  });

  it("shares a denial too, and one caller unmounting doesn't cancel it for the rest", async () => {
    let reject!: (e: unknown) => void;
    fetchSubscription.mockReturnValue(new Promise((_, r) => (reject = r)));
    const first = renderHook(() => useBillingAccess());
    const second = renderHook(() => useBillingAccess());
    first.unmount();
    reject(new ApiError("forbidden", 403));
    await waitFor(() => expect(second.result.current).toBe(false));
    expect(fetchSubscription).toHaveBeenCalledTimes(1);
  });

  it("asks again after a non-403 failure (nothing cached, nothing left in flight)", async () => {
    fetchSubscription.mockRejectedValueOnce(new ApiError("boom", 503));
    const first = renderHook(() => useBillingAccess());
    await waitFor(() => expect(fetchSubscription).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(first.result.current).toBe(true));
    fetchSubscription.mockResolvedValue({ tier: "pro" });
    renderHook(() => useBillingAccess());
    await waitFor(() => expect(fetchSubscription).toHaveBeenCalledTimes(2));
  });
});
