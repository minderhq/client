import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  REFRESH_TIMEOUT_MS,
  SESSION_EXPIRED_EVENT,
  TOKEN_REFRESHED_EVENT,
} from "./api";
import { AuthProvider, useAuth } from "./auth";

const TOKEN_KEY = "minder_jwt";

/** Build a JWT-shaped string (`header.payload.signature`) whose payload is the
 * base64url encoding of `claims` — mirrors jwt.test.ts's helper. */
function makeJwt(claims: Record<string, unknown>): string {
  const b64 = btoa(JSON.stringify(claims))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${b64}.sig`;
}

function renderAuth() {
  return renderHook(() => useAuth(), { wrapper: AuthProvider });
}

describe("AuthProvider / useAuth", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws when used outside an AuthProvider", () => {
    expect(() => renderHook(() => useAuth())).toThrow(
      "useAuth must be used within an AuthProvider",
    );
  });

  it("starts unauthenticated with no token in sessionStorage", () => {
    const { result } = renderAuth();
    expect(result.current.token).toBe("");
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.username).toBe("");
  });

  it("picks up a valid, non-expired token already in sessionStorage", () => {
    const jwt = makeJwt({
      username: "ada",
      email: "ada@example.com",
      role: "admin",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    sessionStorage.setItem(TOKEN_KEY, jwt);

    const { result } = renderAuth();

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.username).toBe("ada");
    expect(result.current.email).toBe("ada@example.com");
    expect(result.current.role).toBe("admin");
  });

  describe("login", () => {
    it("stores the returned token and flips isAuthenticated on success", async () => {
      const jwt = makeJwt({
        username: "ada",
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: jwt }),
      } as Response);

      const { result } = renderAuth();
      await act(async () => {
        await result.current.login("ada", "hunter2");
      });

      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:8000/v1/auth/login",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "ada", password: "hunter2" }),
        }),
      );
      expect(result.current.token).toBe(jwt);
      expect(result.current.isAuthenticated).toBe(true);
      expect(sessionStorage.getItem(TOKEN_KEY)).toBe(jwt);
    });

    it("records must_change_password from the login response (#1776)", async () => {
      const jwt = makeJwt({
        username: "ada",
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: jwt,
          user: { must_change_password: true },
        }),
      } as Response);

      const { result } = renderAuth();
      expect(result.current.mustChangePassword).toBe(false);
      await act(async () => {
        await result.current.login("ada", "temp-pass");
      });
      expect(result.current.mustChangePassword).toBe(true);
      // survives a reload, like the token
      expect(sessionStorage.getItem("minder_must_change_password")).toBe("1");

      act(() => result.current.clearMustChangePassword());
      expect(result.current.mustChangePassword).toBe(false);
      expect(sessionStorage.getItem("minder_must_change_password")).toBeNull();
    });

    it("logout clears a pending forced password change (#1776)", async () => {
      const jwt = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: jwt,
          user: { must_change_password: true },
        }),
      } as Response);
      const { result } = renderAuth();
      await act(async () => {
        await result.current.login("ada", "temp-pass");
      });
      act(() => result.current.logout());
      expect(result.current.mustChangePassword).toBe(false);
      expect(sessionStorage.getItem("minder_must_change_password")).toBeNull();
    });

    it("throws the backend's detail message on failure and leaves state unchanged", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ detail: "Invalid credentials" }),
      } as Response);

      const { result } = renderAuth();
      await expect(
        act(async () => {
          await result.current.login("ada", "wrong");
        }),
      ).rejects.toThrow("Invalid credentials");

      expect(result.current.token).toBe("");
      expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    });

    it("falls back to a generic status message when the error body isn't JSON", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error("not json");
        },
      } as unknown as Response);

      const { result } = renderAuth();
      await expect(
        act(async () => {
          await result.current.login("ada", "wrong");
        }),
      ).rejects.toThrow("Request failed (500)");
    });
  });

  describe("register", () => {
    it("posts username/email/password and does not touch token state on success", async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({}) } as Response);

      const { result } = renderAuth();
      await act(async () => {
        await result.current.register("ada", "ada@example.com", "hunter2");
      });

      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:8000/v1/auth/register",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            username: "ada",
            email: "ada@example.com",
            password: "hunter2",
          }),
        }),
      );
      expect(result.current.isAuthenticated).toBe(false);
    });

    it("throws the backend's detail message on failure", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ detail: "Username already taken" }),
      } as Response);

      const { result } = renderAuth();
      await expect(
        act(async () => {
          await result.current.register("ada", "ada@example.com", "hunter2");
        }),
      ).rejects.toThrow("Username already taken");
    });
  });

  it("loginWithToken sets the token and sessionStorage directly, without a network call", () => {
    const jwt = makeJwt({
      username: "bob",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const { result } = renderAuth();
    const sentAt = Date.now() - 5_000;

    act(() => {
      result.current.loginWithToken(jwt, sentAt);
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.token).toBe(jwt);
    expect(result.current.username).toBe("bob");
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe(jwt);
    // The caller's send time, not the (later) adoption time (#56).
    expect(sessionStorage.getItem("minder_jwt_received_at")).toBe(String(sentAt));
  });

  it("logout clears the token from state and sessionStorage", () => {
    const jwt = makeJwt({
      username: "ada",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    sessionStorage.setItem(TOKEN_KEY, jwt);
    const { result } = renderAuth();
    expect(result.current.isAuthenticated).toBe(true);

    act(() => {
      result.current.logout();
    });

    expect(result.current.token).toBe("");
    expect(result.current.isAuthenticated).toBe(false);
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  describe(`${SESSION_EXPIRED_EVENT} window event (#46)`, () => {
    it("logs the user out when apiFetch/apiFetchBlob dispatch it after a 401", () => {
      const jwt = makeJwt({
        username: "ada",
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      sessionStorage.setItem(TOKEN_KEY, jwt);
      const { result } = renderAuth();
      expect(result.current.isAuthenticated).toBe(true);

      act(() => {
        window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      });

      expect(result.current.token).toBe("");
      expect(result.current.isAuthenticated).toBe(false);
      expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    });

    it("is a no-op when there was never a session", () => {
      const { result } = renderAuth();
      expect(result.current.isAuthenticated).toBe(false);

      act(() => {
        window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      });

      expect(result.current.token).toBe("");
      expect(result.current.isAuthenticated).toBe(false);
    });

    it("stops reacting once the AuthProvider unmounts (listener cleanup)", () => {
      const jwt = makeJwt({
        username: "ada",
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      sessionStorage.setItem(TOKEN_KEY, jwt);
      const { unmount } = renderAuth();

      unmount();

      // Would throw "Uncaught [Error: ...]" style noise or leak a stale
      // listener across tests/instances if the effect's cleanup didn't run.
      expect(() => {
        window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      }).not.toThrow();
    });
  });

  describe("silent refresh before expiry (#53)", () => {
    const REFRESH_URL = "http://localhost:8000/v1/auth/refresh";
    const nowSec = () => Math.floor(Date.now() / 1000);
    const refreshCalls = () =>
      vi.mocked(fetch).mock.calls.filter(([url]) => url === REFRESH_URL);

    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("refreshes at 80% of the remaining lifetime and adopts the new token", async () => {
      const oldJwt = makeJwt({ username: "ada", exp: nowSec() + 100 });
      const newJwt = makeJwt({ username: "ada2", exp: nowSec() + 1000 });
      sessionStorage.setItem(TOKEN_KEY, oldJwt);
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ access_token: newJwt, expires_in: 900 }),
      } as Response);
      const { result } = renderAuth();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(79_000);
      });
      expect(refreshCalls()).toHaveLength(0);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(refreshCalls()).toHaveLength(1);
      expect(refreshCalls()[0][1]).toMatchObject({
        method: "POST",
        headers: { Authorization: `Bearer ${oldJwt}` },
      });
      expect(result.current.token).toBe(newJwt);
      expect(result.current.username).toBe("ada2");
      expect(result.current.isAuthenticated).toBe(true);
      expect(sessionStorage.getItem(TOKEN_KEY)).toBe(newJwt);
    });

    it("logs out when the scheduled refresh is rejected (revoked session)", async () => {
      sessionStorage.setItem(TOKEN_KEY, makeJwt({ username: "ada", exp: nowSec() + 100 }));
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ detail: "Account is disabled or no longer exists" }),
      } as Response);
      const { result } = renderAuth();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(81_000);
      });

      expect(refreshCalls()).toHaveLength(1);
      expect(result.current.token).toBe("");
      expect(result.current.isAuthenticated).toBe(false);
      expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    });

    it("retries a transiently failed scheduled refresh instead of logging out", async () => {
      sessionStorage.setItem(TOKEN_KEY, makeJwt({ username: "ada", exp: nowSec() + 1000 }));
      vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
      const { result } = renderAuth();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(801_000);
      });
      expect(refreshCalls()).toHaveLength(1);
      expect(result.current.isAuthenticated).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(refreshCalls()).toHaveLength(2);
      expect(result.current.isAuthenticated).toBe(true);
    });

    it("refreshes almost immediately when a stored token is near expiry", async () => {
      sessionStorage.setItem(TOKEN_KEY, makeJwt({ username: "ada", exp: nowSec() + 2 }));
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ access_token: makeJwt({ exp: nowSec() + 900 }) }),
      } as Response);
      renderAuth();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_700);
      });

      expect(refreshCalls()).toHaveLength(1);
    });

    it("schedules nothing for a non-expiring token", async () => {
      sessionStorage.setItem(TOKEN_KEY, makeJwt({ username: "svc" }));
      renderAuth();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10 * 24 * 3600 * 1000);
      });

      expect(fetch).not.toHaveBeenCalled();
    });

    it("logout clears the pending refresh timer", async () => {
      sessionStorage.setItem(TOKEN_KEY, makeJwt({ username: "ada", exp: nowSec() + 100 }));
      const { result } = renderAuth();

      act(() => {
        result.current.logout();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200_000);
      });

      expect(fetch).not.toHaveBeenCalled();
    });

    it("a token swap (e.g. loginWithToken) reschedules against the new expiry", async () => {
      sessionStorage.setItem(TOKEN_KEY, makeJwt({ username: "ada", exp: nowSec() + 100 }));
      vi.mocked(fetch).mockRejectedValue(new TypeError("offline"));
      const { result } = renderAuth();

      act(() => {
        result.current.loginWithToken(
          makeJwt({ username: "bob", exp: nowSec() + 1000 }),
          Date.now(),
        );
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100_000);
      });
      expect(refreshCalls()).toHaveLength(0);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(701_000);
      });
      expect(refreshCalls()).toHaveLength(1);
    });

    describe("clock skew (#53 review)", () => {
      // The server's "now"; tokens are minted with its iat/exp, 5-min lifetime.
      const SERVER_NOW = Date.parse("2030-01-01T00:00:00Z");
      const token5m = (claims: Record<string, unknown> = {}) =>
        makeJwt({
          username: "ada",
          iat: SERVER_NOW / 1000,
          exp: SERVER_NOW / 1000 + 300,
          ...claims,
        });

      it.each([
        ["behind", -600_000],
        ["ahead of", 600_000],
      ])(
        "refreshes before real expiry with the client clock 10 min %s the server",
        async (_label, skewMs) => {
          vi.setSystemTime(SERVER_NOW + skewMs);
          vi.mocked(fetch).mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ access_token: token5m({ username: "ada2" }) }),
          } as Response);
          const { result } = renderAuth();

          act(() => {
            result.current.loginWithToken(token5m(), Date.now());
          });
          // Skew doesn't make a freshly received token read as expired.
          expect(result.current.isAuthenticated).toBe(true);

          await act(async () => {
            await vi.advanceTimersByTimeAsync(239_000);
          });
          expect(refreshCalls()).toHaveLength(0);

          await act(async () => {
            await vi.advanceTimersByTimeAsync(2_000); // t = 241s < 300s real expiry
          });
          expect(refreshCalls()).toHaveLength(1);
          expect(result.current.username).toBe("ada2");
        },
      );

      it("keeps the local receive time across a reload", async () => {
        // Received 200s ago (local clock), client clock 10 min behind.
        vi.setSystemTime(SERVER_NOW - 600_000 + 200_000);
        sessionStorage.setItem(TOKEN_KEY, token5m());
        sessionStorage.setItem("minder_jwt_received_at", String(SERVER_NOW - 600_000));
        renderAuth();

        await act(async () => {
          await vi.advanceTimersByTimeAsync(39_000);
        });
        expect(refreshCalls()).toHaveLength(0);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2_000); // 240s after receipt
        });
        expect(refreshCalls()).toHaveLength(1);
      });

      it("uses the same local basis for the transient-failure retry window", async () => {
        vi.setSystemTime(SERVER_NOW - 600_000); // client 10 min behind
        vi.mocked(fetch).mockRejectedValue(new TypeError("offline"));
        const { result } = renderAuth();
        act(() => {
          result.current.loginWithToken(token5m(), Date.now());
        });

        // First attempt at 240s, then retries every min(30s, remaining/2)
        // (>= 1s apart): 270s, 285s, 292.5s, ... -- all before the real 300s
        // expiry -- then exactly one attempt after it (#56), then nothing.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(299_999);
        });
        const beforeExpiry = refreshCalls().length;
        expect(beforeExpiry).toBeGreaterThanOrEqual(4);
        expect(beforeExpiry).toBeLessThanOrEqual(10);
        expect(result.current.isAuthenticated).toBe(true);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(600_000);
        });
        expect(refreshCalls()).toHaveLength(beforeExpiry + 1);
        // The token stays stored (no verdict from the API), but reads as
        // logged out once its one post-expiry attempt has failed.
        expect(result.current.token).not.toBe("");
        expect(result.current.isAuthenticated).toBe(false);
      });
    });

    describe("expired token: refresh instead of logging out (#56)", () => {
      /** A fetch whose response the test settles by hand, to observe the
       * state while the refresh is in flight. */
      function deferredFetch() {
        let settle: (r: Response) => void = () => {};
        vi.mocked(fetch).mockImplementation(
          () => new Promise<Response>((resolve) => (settle = resolve)),
        );
        return {
          ok: (jwt: string) =>
            settle({
              ok: true,
              status: 200,
              json: async () => ({ access_token: jwt }),
            } as Response),
          reject: (status: number) =>
            settle({
              ok: false,
              status,
              json: async () => ({ detail: "Token expired" }),
            } as Response),
        };
      }

      it("reload with an expired token: stays logged in when the refresh succeeds", async () => {
        const expired = makeJwt({ username: "ada", exp: nowSec() - 60 });
        const fresh = makeJwt({ username: "ada", exp: nowSec() + 900 });
        sessionStorage.setItem(TOKEN_KEY, expired);
        const res = deferredFetch();
        const { result } = renderAuth();
        const sessionKeyBefore = result.current.sessionKey;
        expect(sessionKeyBefore).not.toBe("");

        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
        expect(refreshCalls()).toHaveLength(1);
        expect(refreshCalls()[0][1]).toMatchObject({
          headers: { Authorization: `Bearer ${expired}` },
        });

        await act(async () => {
          res.ok(fresh);
          await vi.advanceTimersByTimeAsync(0);
        });
        expect(result.current.token).toBe(fresh);
        expect(result.current.isAuthenticated).toBe(true);
        expect(sessionStorage.getItem(TOKEN_KEY)).toBe(fresh);
        // A silent refresh of the same session: loaders keyed on sessionKey
        // (#55) don't refetch just because it landed after expiry.
        expect(result.current.sessionKey).toBe(sessionKeyBefore);
      });

      it.each([401, 403])(
        "reload with an expired token: logs out when the refresh is rejected (%i)",
        async (status) => {
          sessionStorage.setItem(TOKEN_KEY, makeJwt({ username: "ada", exp: nowSec() - 60 }));
          const res = deferredFetch();
          const { result } = renderAuth();
          await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
          });

          await act(async () => {
            res.reject(status);
            await vi.advanceTimersByTimeAsync(0);
          });
          expect(refreshCalls()).toHaveLength(1);
          expect(result.current.token).toBe("");
          expect(result.current.isAuthenticated).toBe(false);
          expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
        },
      );

      it("shows no logged-out state while the refresh is pending", async () => {
        sessionStorage.setItem(TOKEN_KEY, makeJwt({ username: "ada", exp: nowSec() - 60 }));
        const res = deferredFetch();
        const seen: boolean[] = [];
        const { result } = renderHook(
          () => {
            const auth = useAuth();
            seen.push(auth.isAuthenticated);
            return auth;
          },
          { wrapper: AuthProvider },
        );

        await act(async () => {
          await vi.advanceTimersByTimeAsync(60_000);
        });
        expect(refreshCalls()).toHaveLength(1);
        expect(result.current.username).toBe("ada");
        await act(async () => {
          res.ok(makeJwt({ username: "ada", exp: nowSec() + 900 }));
          await vi.advanceTimersByTimeAsync(0);
        });

        // Every render -- the first one included -- read as logged in.
        expect(seen.length).toBeGreaterThan(1);
        expect(seen.every(Boolean)).toBe(true);
      });

      it("reads as logged out (without retrying) once the one attempt fails transiently", async () => {
        sessionStorage.setItem(TOKEN_KEY, makeJwt({ username: "ada", exp: nowSec() - 60 }));
        vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
        const { result } = renderAuth();

        await act(async () => {
          await vi.advanceTimersByTimeAsync(10 * 60_000);
        });
        expect(refreshCalls()).toHaveLength(1);
        expect(result.current.isAuthenticated).toBe(false);
      });

      it("a new login after abandonment reads as authenticated", async () => {
        sessionStorage.setItem(TOKEN_KEY, makeJwt({ username: "ada", exp: nowSec() - 60 }));
        vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
        const { result } = renderAuth();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
        expect(result.current.isAuthenticated).toBe(false);

        const fresh = makeJwt({ username: "ada", exp: nowSec() + 900 });
        act(() => {
          result.current.loginWithToken(fresh, Date.now());
        });
        expect(result.current.token).toBe(fresh);
        expect(result.current.isAuthenticated).toBe(true);
      });

      describe("a refresh request that never settles", () => {
        /** A fetch that only ever ends by aborting, like a hung socket. */
        const hangingFetch = () =>
          vi.mocked(fetch).mockImplementation(
            (_url, init) =>
              new Promise<Response>((_resolve, reject) => {
                const signal = init?.signal;
                signal?.addEventListener("abort", () => reject(signal.reason));
              }),
          );

        it("times out and abandons an expired token", async () => {
          sessionStorage.setItem(TOKEN_KEY, makeJwt({ username: "ada", exp: nowSec() - 60 }));
          hangingFetch();
          const { result } = renderAuth();

          await act(async () => {
            await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS - 1);
          });
          expect(refreshCalls()).toHaveLength(1);
          expect(refreshCalls()[0][1]?.signal).toBeInstanceOf(AbortSignal);
          expect(result.current.isAuthenticated).toBe(true); // still pending

          await act(async () => {
            await vi.advanceTimersByTimeAsync(1);
          });
          expect(result.current.isAuthenticated).toBe(false);
          await act(async () => {
            await vi.advanceTimersByTimeAsync(10 * 60_000);
          });
          expect(refreshCalls()).toHaveLength(1); // abandoned, not retried
        });

        it("retries before expiry, then abandons after the post-expiry attempt times out", async () => {
          // exp in 100s: first attempt at 80s, times out at 95s; retry at
          // 97.5s (remaining/2) times out at 112.5s, past expiry; the one
          // post-expiry attempt starts at once and times out at 127.5s.
          sessionStorage.setItem(TOKEN_KEY, makeJwt({ username: "ada", exp: nowSec() + 100 }));
          hangingFetch();
          const { result } = renderAuth();

          await act(async () => {
            await vi.advanceTimersByTimeAsync(98_000);
          });
          expect(refreshCalls()).toHaveLength(2);
          expect(result.current.isAuthenticated).toBe(true);

          await act(async () => {
            await vi.advanceTimersByTimeAsync(20_000); // t = 118s: expired, pending
          });
          expect(refreshCalls()).toHaveLength(3);
          expect(result.current.isAuthenticated).toBe(true);

          await act(async () => {
            await vi.advanceTimersByTimeAsync(10_000); // t = 128s
          });
          expect(result.current.isAuthenticated).toBe(false);
          expect(refreshCalls()).toHaveLength(3);
        });
      });

      describe("an overdue timer after a wake", () => {
        // Scheduled for 80s; the machine sleeps and wakes 10 min later, past
        // expiry, before the (overdue) timer has run.
        const sleepPastExpiry = (rerender: () => void) => {
          vi.setSystemTime(Date.now() + 10 * 60_000);
          rerender();
        };

        it("stays logged in until the refresh settles, then adopts the new token", async () => {
          sessionStorage.setItem(TOKEN_KEY, makeJwt({ username: "ada", exp: nowSec() + 100 }));
          const res = deferredFetch();
          const { result, rerender } = renderAuth();

          sleepPastExpiry(rerender);
          // Rendered past expiry, refresh not even started yet.
          expect(refreshCalls()).toHaveLength(0);
          expect(result.current.isAuthenticated).toBe(true);

          await act(async () => {
            await vi.advanceTimersByTimeAsync(80_000); // the overdue timer runs
          });
          expect(refreshCalls()).toHaveLength(1);
          expect(result.current.isAuthenticated).toBe(true);

          const fresh = makeJwt({ username: "ada", exp: nowSec() + 900 });
          await act(async () => {
            res.ok(fresh);
            await vi.advanceTimersByTimeAsync(0);
          });
          expect(result.current.token).toBe(fresh);
          expect(result.current.isAuthenticated).toBe(true);
        });

        it("logs out when that refresh is rejected", async () => {
          sessionStorage.setItem(TOKEN_KEY, makeJwt({ username: "ada", exp: nowSec() + 100 }));
          const res = deferredFetch();
          const { result, rerender } = renderAuth();

          sleepPastExpiry(rerender);
          await act(async () => {
            await vi.advanceTimersByTimeAsync(80_000);
          });
          expect(result.current.isAuthenticated).toBe(true);

          await act(async () => {
            res.reject(401);
            await vi.advanceTimersByTimeAsync(0);
          });
          expect(refreshCalls()).toHaveLength(1);
          expect(result.current.token).toBe("");
          expect(result.current.isAuthenticated).toBe(false);
        });
      });
    });

    it(`adopts a token announced via ${TOKEN_REFRESHED_EVENT} (401 retry path)`, () => {
      sessionStorage.setItem(TOKEN_KEY, makeJwt({ username: "ada", exp: nowSec() + 100 }));
      const { result } = renderAuth();
      const fresh = makeJwt({ username: "ada", exp: nowSec() + 900 });

      act(() => {
        window.dispatchEvent(new CustomEvent(TOKEN_REFRESHED_EVENT, { detail: fresh }));
      });

      expect(result.current.token).toBe(fresh);
    });
  });

  describe("sessionKey (#55)", () => {
    const exp = (s: number) => Math.floor(Date.now() / 1000) + s;
    const jwt = (claims: Record<string, unknown>) =>
      makeJwt({ sub: "7", username: "ada", active_tenant_id: "1", ...claims });
    const refreshTo = (fresh: string) =>
      act(() => {
        window.dispatchEvent(new CustomEvent(TOKEN_REFRESHED_EVENT, { detail: fresh }));
      });

    it("is empty with no token", () => {
      expect(renderAuth().result.current.sessionKey).toBe("");
    });

    it("stays the same across a silent refresh of the same user and org", () => {
      sessionStorage.setItem(TOKEN_KEY, jwt({ exp: exp(100) }));
      const { result } = renderAuth();
      const before = result.current.sessionKey;
      expect(before).not.toBe("");

      const fresh = jwt({ exp: exp(900) });
      refreshTo(fresh);

      expect(result.current.token).toBe(fresh);
      expect(result.current.sessionKey).toBe(before);
    });

    it("changes when a refresh lands in a different active org", () => {
      sessionStorage.setItem(TOKEN_KEY, jwt({ exp: exp(100) }));
      const { result } = renderAuth();
      const before = result.current.sessionKey;

      refreshTo(jwt({ exp: exp(900), active_tenant_id: "2" }));

      expect(result.current.sessionKey).not.toBe(before);
    });

    it("changes on an org switch", async () => {
      sessionStorage.setItem(TOKEN_KEY, jwt({ exp: exp(3600) }));
      const { result } = renderAuth();
      const before = result.current.sessionKey;
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: jwt({ exp: exp(3600), active_tenant_id: "2" }) }),
      } as Response);

      await act(async () => {
        await result.current.switchOrg(2);
      });

      expect(result.current.sessionKey).not.toBe(before);
    });

    it("changes on an explicit token adoption even for the same user and org", () => {
      sessionStorage.setItem(TOKEN_KEY, jwt({ exp: exp(3600) }));
      const { result } = renderAuth();
      const before = result.current.sessionKey;

      act(() => {
        result.current.loginWithToken(jwt({ exp: exp(7200) }), Date.now());
      });
      expect(result.current.sessionKey).not.toBe(before);

      act(() => {
        result.current.logout();
      });
      expect(result.current.sessionKey).toBe("");
    });
  });
});
