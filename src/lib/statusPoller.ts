import { ApiError } from "./api";

/** One shared loop for "poll this until it's done" requests (#136).
 *
 * The knowledge-base upload widget used to run one 3 s timer per uploading
 * document and treat any error -- including a 429 from the server's rate
 * limit -- as a failed upload. With several uploads at once those polls hit
 * the limit and healthy ingestions showed up as failed.
 *
 * This scheduler keeps a single timer for every watched item and polls the
 * due ones one after another, so N uploads never fire N requests at once.
 * Per item:
 * - the wait grows 3 s -> 6 s -> 12 s -> 15 s (capped) while the response
 *   stays the same, and drops back to 3 s when it changes;
 * - a 429 is "still working": wait `Retry-After` seconds, clamped to
 *   [3 s, 60 s] (or the current wait when the header is missing), and try
 *   again -- never a failure;
 * - each request gets a timeout (10 s): a hung request is aborted and counts
 *   as a transient error, so it can't stall the loop for other documents;
 * - a 404 stops polling at once and rejects (the document is gone);
 * - any other error is retried with the same backoff, and rejects only after
 *   `maxErrorRetries` failures in a row.
 */

export const STATUS_POLL_BASE_MS = 3000;
export const STATUS_POLL_MAX_MS = 15000;
export const STATUS_POLL_MAX_ERROR_RETRIES = 3;
export const STATUS_POLL_TIMEOUT_MS = 10000;
export const STATUS_POLL_RETRY_AFTER_MAX_MS = 60000;

export interface StatusPollOptions {
  baseMs?: number;
  maxMs?: number;
  maxErrorRetries?: number;
  /** Per-request timeout. */
  timeoutMs?: number;
  /** Upper bound for a server-sent `Retry-After` (the lower bound is baseMs). */
  retryAfterMaxMs?: number;
}

/** Rejection reason for a watch cancelled through its AbortSignal. */
export class PollCancelledError extends Error {
  constructor() {
    super("Polling cancelled");
    this.name = "PollCancelledError";
  }
}

/** Rejection reason for a single poll request that took too long. */
export class PollTimeoutError extends Error {
  constructor() {
    super("Status request timed out");
    this.name = "PollTimeoutError";
  }
}

interface Entry {
  fetch: (signal: AbortSignal) => Promise<unknown>;
  signal: AbortSignal | undefined;
  isDone: (res: unknown) => boolean;
  nextAt: number;
  delayMs: number;
  last: string | undefined;
  errors: number;
  resolve: (res: unknown) => void;
  reject: (err: unknown) => void;
  cleanup: () => void;
}

export class StatusPollScheduler {
  private readonly baseMs: number;
  private readonly maxMs: number;
  private readonly maxErrorRetries: number;
  private readonly timeoutMs: number;
  private readonly retryAfterMaxMs: number;
  private readonly entries = new Map<number, Entry>();
  private nextId = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(opts: StatusPollOptions = {}) {
    this.baseMs = opts.baseMs ?? STATUS_POLL_BASE_MS;
    this.maxMs = opts.maxMs ?? STATUS_POLL_MAX_MS;
    this.maxErrorRetries = opts.maxErrorRetries ?? STATUS_POLL_MAX_ERROR_RETRIES;
    this.timeoutMs = opts.timeoutMs ?? STATUS_POLL_TIMEOUT_MS;
    this.retryAfterMaxMs = opts.retryAfterMaxMs ?? STATUS_POLL_RETRY_AFTER_MAX_MS;
  }

  /** Number of items still being polled. */
  get size(): number {
    return this.entries.size;
  }

  /** Polls `fetch` (first call right away) until `isDone` accepts a response,
   * which the promise resolves with. Rejects on 404, after too many non-429
   * errors in a row, or with PollCancelledError when `signal` aborts.
   * `fetch` gets a per-request signal that aborts on timeout or cancel. */
  watch<T>(
    fetch: (signal: AbortSignal) => Promise<T>,
    isDone: (res: T) => boolean,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) return Promise.reject(new PollCancelledError());
    return new Promise<T>((resolve, reject) => {
      const id = this.nextId++;
      const onAbort = () => {
        if (!this.entries.has(id)) return;
        this.remove(id);
        reject(new PollCancelledError());
      };
      signal?.addEventListener("abort", onAbort);
      this.entries.set(id, {
        fetch,
        signal,
        isDone: isDone as (res: unknown) => boolean,
        nextAt: Date.now(),
        delayMs: this.baseMs,
        last: undefined,
        errors: 0,
        resolve: resolve as (res: unknown) => void,
        reject,
        cleanup: () => signal?.removeEventListener("abort", onAbort),
      });
      this.arm();
    });
  }

  private remove(id: number) {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.cleanup();
    this.entries.delete(id);
    if (this.entries.size === 0 && this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** (Re)sets the single timer to the earliest due item. A running tick
   * re-arms itself when it finishes. */
  private arm() {
    if (this.running) return;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.entries.size === 0) return;
    let next = Infinity;
    for (const e of this.entries.values()) next = Math.min(next, e.nextAt);
    this.timer = setTimeout(
      () => void this.tick(),
      Math.max(0, next - Date.now()),
    );
  }

  private async tick() {
    this.timer = null;
    this.running = true;
    try {
      for (const id of [...this.entries.keys()]) {
        const entry = this.entries.get(id);
        if (!entry || entry.nextAt > Date.now()) continue;
        await this.pollOnce(id, entry);
      }
    } finally {
      this.running = false;
      this.arm();
    }
  }

  private grow(delayMs: number): number {
    return Math.min(delayMs * 2, this.maxMs);
  }

  /** One request, settled by whichever comes first: the response, the
   * timeout, or the watch's cancel. Timeout and cancel also abort the request
   * itself, and the race means a fetch that ignores its signal still can't
   * hold up the loop. */
  private fetchOnce(entry: Entry): Promise<unknown> {
    const controller = new AbortController();
    return new Promise((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        entry.signal?.removeEventListener("abort", onAbort);
      };
      const fail = (err: Error) => {
        finish();
        controller.abort(err);
        reject(err);
      };
      const onAbort = () => fail(new PollCancelledError());
      const timer = setTimeout(() => fail(new PollTimeoutError()), this.timeoutMs);
      entry.signal?.addEventListener("abort", onAbort);
      entry.fetch(controller.signal).then(
        (res) => {
          finish();
          resolve(res);
        },
        (err: unknown) => {
          finish();
          reject(err);
        },
      );
    });
  }

  private async pollOnce(id: number, entry: Entry) {
    let res: unknown;
    try {
      res = await this.fetchOnce(entry);
    } catch (err) {
      if (!this.entries.has(id)) return; // cancelled while in flight
      if (err instanceof ApiError && err.status === 429) {
        // Rate limited: the work is still running, just ask again later --
        // when the server says, else after the current wait, which then
        // grows so repeated 429s back off.
        if (err.retryAfterSeconds !== null) {
          // Clamped: 0 must not mean "hammer it", nor a huge value "stall".
          const waitMs = Math.min(
            Math.max(err.retryAfterSeconds * 1000, this.baseMs),
            this.retryAfterMaxMs,
          );
          entry.nextAt = Date.now() + waitMs;
        } else {
          entry.nextAt = Date.now() + entry.delayMs;
          entry.delayMs = this.grow(entry.delayMs);
        }
        return;
      }
      entry.errors += 1;
      const notFound = err instanceof ApiError && err.status === 404;
      if (notFound || entry.errors > this.maxErrorRetries) {
        this.remove(id);
        entry.reject(err);
        return;
      }
      entry.nextAt = Date.now() + entry.delayMs;
      entry.delayMs = this.grow(entry.delayMs);
      return;
    }
    if (!this.entries.has(id)) return; // cancelled while in flight
    entry.errors = 0;
    if (entry.isDone(res)) {
      this.remove(id);
      entry.resolve(res);
      return;
    }
    const fingerprint = JSON.stringify(res);
    entry.delayMs =
      fingerprint === entry.last ? this.grow(entry.delayMs) : this.baseMs;
    entry.last = fingerprint;
    entry.nextAt = Date.now() + entry.delayMs;
  }
}

/** The one scheduler every upload widget on the page shares. */
export const documentStatusPoller = new StatusPollScheduler();
