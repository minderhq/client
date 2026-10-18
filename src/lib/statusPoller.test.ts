import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./api";
import { PollCancelledError, StatusPollScheduler } from "./statusPoller";

type Res = { status: string; n?: number };
const done = (r: Res) => r.status !== "processing";
const tooMany = (retryAfterSeconds: number | null = null) =>
  new ApiError("Too many requests", 429, { retryAfterSeconds });

/** Times (ms since start) at which `fetch` was called. */
function recorder(impl: (call: number) => Promise<Res>) {
  const start = Date.now();
  const times: number[] = [];
  const fetch = vi.fn(() => {
    times.push(Date.now() - start);
    return impl(times.length);
  });
  return { fetch, times };
}

describe("StatusPollScheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("backs off 3 s -> 6 s -> 12 s and stays capped at 15 s", async () => {
    const poller = new StatusPollScheduler();
    const { fetch, times } = recorder(async () => ({ status: "processing" }));
    void poller.watch(fetch, done);

    await vi.advanceTimersByTimeAsync(80_000);

    const gaps = times.slice(1).map((t, i) => t - times[i]);
    expect(times[0]).toBe(0);
    expect(gaps.slice(0, 6)).toEqual([3000, 6000, 12000, 15000, 15000, 15000]);
    expect(Math.max(...gaps)).toBe(15000);
  });

  it("resets the backoff when the response changes", async () => {
    const poller = new StatusPollScheduler();
    const { fetch, times } = recorder(async (call) => ({
      status: "processing",
      n: call >= 4 ? 1 : 0, // progress moves on the 4th poll
    }));
    void poller.watch(fetch, done);

    await vi.advanceTimersByTimeAsync(30_000);

    const gaps = times.slice(1).map((t, i) => t - times[i]);
    // 0, 3, 9, 21 (changed -> reset to 3 s), 24, ...
    expect(gaps.slice(0, 4)).toEqual([3000, 6000, 12000, 3000]);
  });

  it("treats 429 as still processing and honours Retry-After", async () => {
    const poller = new StatusPollScheduler();
    const { fetch, times } = recorder(async (call) => {
      if (call === 1) throw tooMany(7);
      if (call === 2) throw tooMany(null); // no header: current interval
      return { status: "completed" };
    });
    const result = poller.watch(fetch, done);

    await vi.advanceTimersByTimeAsync(20_000);

    await expect(result).resolves.toEqual({ status: "completed" });
    expect(times).toEqual([0, 7000, 10000]);
  });

  it("never fails on repeated 429s", async () => {
    const poller = new StatusPollScheduler();
    const { fetch } = recorder(async (call) => {
      if (call <= 20) throw tooMany();
      return { status: "completed" };
    });
    const result = poller.watch(fetch, done);

    await vi.advanceTimersByTimeAsync(400_000);

    await expect(result).resolves.toEqual({ status: "completed" });
  });

  it("stops on 404 without retrying", async () => {
    const poller = new StatusPollScheduler();
    const { fetch } = recorder(async () => {
      throw new ApiError("Not found", 404);
    });
    const result = poller.watch(fetch, done);
    const settled = expect(result).rejects.toMatchObject({ status: 404 });

    await vi.advanceTimersByTimeAsync(60_000);

    await settled;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(poller.size).toBe(0);
  });

  it("fails on other errors only after bounded retries", async () => {
    const poller = new StatusPollScheduler({ maxErrorRetries: 3 });
    const { fetch } = recorder(async () => {
      throw new ApiError("Boom", 500);
    });
    const result = poller.watch(fetch, done);
    const settled = expect(result).rejects.toMatchObject({ status: 500 });

    await vi.advanceTimersByTimeAsync(120_000);

    await settled;
    expect(fetch).toHaveBeenCalledTimes(4); // first try + 3 retries
  });

  it("recovers from a transient error", async () => {
    const poller = new StatusPollScheduler();
    const { fetch } = recorder(async (call) => {
      if (call === 1) throw new TypeError("Failed to fetch");
      return { status: "completed" };
    });
    const result = poller.watch(fetch, done);

    await vi.advanceTimersByTimeAsync(5_000);

    await expect(result).resolves.toEqual({ status: "completed" });
  });

  it("polls many items from one timer, one request at a time", async () => {
    const poller = new StatusPollScheduler();
    let inFlight = 0;
    let maxInFlight = 0;
    const fetches = Array.from({ length: 10 }, () =>
      vi.fn(async (): Promise<Res> => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return { status: "processing" };
      }),
    );
    fetches.forEach((f) => void poller.watch(f, done));

    await vi.advanceTimersByTimeAsync(10_000);

    expect(maxInFlight).toBe(1);
    fetches.forEach((f) => expect(f).toHaveBeenCalledTimes(3)); // 0, 3 s, 9 s
    // One shared timer for all ten items, not one per item.
    expect(vi.getTimerCount()).toBe(1);
  });

  it("stops polling when the signal aborts", async () => {
    const poller = new StatusPollScheduler();
    const controller = new AbortController();
    const { fetch } = recorder(async () => ({ status: "processing" }));
    const result = poller.watch(fetch, done, controller.signal);
    const settled = expect(result).rejects.toBeInstanceOf(PollCancelledError);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    controller.abort();
    await settled;

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(poller.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
