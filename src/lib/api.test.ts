import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  apiFetch,
  apiFetchBlob,
  ApiError,
  friendlyErrorMessage,
  refreshAccessToken,
  SESSION_EXPIRED_EVENT,
  TOKEN_KEY,
  TOKEN_RECEIVED_AT_KEY,
  TOKEN_REFRESHED_EVENT,
} from "./api";

describe("ApiError", () => {
  it("is an Error that carries the HTTP status", () => {
    const err = new ApiError("nope", 404);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(404);
    expect(err.message).toBe("nope");
  });
});

describe("friendlyErrorMessage", () => {
  it("maps a 401 ApiError to an actionable session message", () => {
    expect(friendlyErrorMessage(new ApiError("Not authenticated", 401))).toMatch(
      /session expired/i,
    );
  });

  it("passes through a non-401 ApiError's own message", () => {
    expect(friendlyErrorMessage(new ApiError("boom", 500))).toBe("boom");
  });

  it("uses .message for a plain Error", () => {
    expect(friendlyErrorMessage(new Error("plain"))).toBe("plain");
  });

  it("stringifies a non-Error value", () => {
    expect(friendlyErrorMessage("weird")).toBe("weird");
  });
});

describe("apiFetch", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs with no body/Content-Type by default and returns parsed JSON", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ hello: "world" }),
    } as Response);

    const result = await apiFetch<{ hello: string }>("/v1/things");

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8000/v1/things",
      expect.objectContaining({ method: "GET", headers: {}, body: undefined }),
    );
    expect(result).toEqual({ hello: "world" });
  });

  it("JSON-stringifies a plain object body and sets Content-Type", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 1 }),
    } as Response);

    await apiFetch("/v1/things", { method: "POST", body: { name: "x" } });

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8000/v1/things",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "x" }),
      }),
    );
  });

  it("passes a FormData body through untouched, without a Content-Type header", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);
    const form = new FormData();
    form.append("file", "contents");

    await apiFetch("/v1/upload", { method: "POST", body: form });

    const call = vi.mocked(fetch).mock.calls[0];
    const init = call[1] as RequestInit;
    expect(init.headers).toEqual({});
    expect(init.body).toBe(form);
  });

  it("adds a Bearer Authorization header when a token is given", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);

    await apiFetch("/v1/things", { token: "abc123" });

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8000/v1/things",
      expect.objectContaining({
        headers: { Authorization: "Bearer abc123" },
      }),
    );
  });

  it("returns undefined for a 204 No Content response without calling .json()", async () => {
    const json = vi.fn();
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 204, json } as unknown as Response);

    const result = await apiFetch("/v1/things/1", { method: "DELETE" });

    expect(result).toBeUndefined();
    expect(json).not.toHaveBeenCalled();
  });

  it("throws an ApiError carrying the string detail on a non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ detail: "Not found" }),
    } as Response);

    await expect(apiFetch("/v1/things/99")).rejects.toMatchObject({
      message: "Not found",
      status: 404,
    });
  });

  it("JSON.stringifies a non-string detail (e.g. FastAPI validation errors)", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ detail: [{ loc: ["body", "name"], msg: "required" }] }),
    } as Response);

    await expect(apiFetch("/v1/things")).rejects.toMatchObject({
      message: JSON.stringify([{ loc: ["body", "name"], msg: "required" }]),
      status: 422,
    });
  });

  it("surfaces the `error` field of a structured detail object (install-from-git)", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        detail: { error: "Repository URL is not allowed" },
      }),
    } as Response);

    await expect(apiFetch("/v1/plugins/install-from-git")).rejects.toMatchObject({
      message: "Repository URL is not allowed",
      status: 400,
    });
  });

  it("appends a structured detail's sub-errors to its error message", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        detail: {
          error: "Invalid manifest",
          errors: ["metadata.name is required", "spec.trigger missing"],
        },
      }),
    } as Response);

    await expect(apiFetch("/v1/plugins/install-from-git")).rejects.toMatchObject({
      message:
        "Invalid manifest: metadata.name is required; spec.trigger missing",
      status: 422,
    });
  });

  it("falls back to a generic status message when there's no detail at all", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response);

    await expect(apiFetch("/v1/things")).rejects.toMatchObject({
      message: "Request failed (500)",
      status: 500,
    });
  });

  it("falls back to a generic status message when the error body isn't JSON", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response);

    await expect(apiFetch("/v1/things")).rejects.toMatchObject({
      message: "Request failed (502)",
      status: 502,
    });
  });

  describe("global 401 handling (#46)", () => {
    it("clears the stored token and dispatches the session-expired event on a 401", async () => {
      sessionStorage.setItem(TOKEN_KEY, "stale-token");
      const onSessionExpired = vi.fn();
      window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ detail: "Not authenticated" }),
      } as Response);

      try {
        await expect(apiFetch("/v1/things")).rejects.toMatchObject({
          message: "Not authenticated",
          status: 401,
        });

        expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
        expect(onSessionExpired).toHaveBeenCalledTimes(1);
      } finally {
        window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
      }
    });

    it.each([403, 500])(
      "does NOT clear the token or dispatch the event for a %d",
      async (status) => {
        sessionStorage.setItem(TOKEN_KEY, "still-valid-token");
        const onSessionExpired = vi.fn();
        window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
        vi.mocked(fetch).mockResolvedValue({
          ok: false,
          status,
          json: async () => ({ detail: "nope" }),
        } as Response);

        try {
          await expect(apiFetch("/v1/things")).rejects.toMatchObject({ status });

          expect(sessionStorage.getItem(TOKEN_KEY)).toBe("still-valid-token");
          expect(onSessionExpired).not.toHaveBeenCalled();
        } finally {
          window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
        }
      },
    );
  });
});

describe("silent refresh on 401 (#53)", () => {
  const REFRESH_URL = "http://localhost:8000/v1/auth/refresh";
  const json = (status: number, data: unknown) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => data }) as Response;
  const authOf = (init: RequestInit | undefined) =>
    (init?.headers as Record<string, string> | undefined)?.Authorization;
  const refreshCalls = () =>
    vi.mocked(fetch).mock.calls.filter(([url]) => url === REFRESH_URL);

  let onSessionExpired: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    sessionStorage.clear();
    sessionStorage.setItem(TOKEN_KEY, "old-token");
    onSessionExpired = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
  });
  afterEach(() => {
    window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
    vi.unstubAllGlobals();
  });

  /** API that 401s the old token, accepts the new one, and answers the
   * refresh endpoint with `refresh` (default: a new token). */
  function mockApi(refresh: () => Promise<Response> = async () =>
    json(200, { access_token: "new-token", expires_in: 900 })) {
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (url === REFRESH_URL) return refresh();
      return authOf(init) === "Bearer new-token"
        ? json(200, { ok: true })
        : json(401, { detail: "Token expired" });
    });
  }

  it("refreshes once and replays the original request with the new token", async () => {
    mockApi();
    const onRefreshed = vi.fn();
    window.addEventListener(TOKEN_REFRESHED_EVENT, onRefreshed);
    try {
      const result = await apiFetch("/v1/things", {
        method: "POST",
        body: { a: 1 },
        token: "old-token",
      });

      expect(result).toEqual({ ok: true });
      const calls = vi.mocked(fetch).mock.calls;
      expect(calls.map(([url]) => url)).toEqual([
        "http://localhost:8000/v1/things",
        REFRESH_URL,
        "http://localhost:8000/v1/things",
      ]);
      expect(authOf(calls[1][1])).toBe("Bearer old-token");
      expect(calls[2][1]).toMatchObject({ method: "POST", body: JSON.stringify({ a: 1 }) });
      expect(sessionStorage.getItem(TOKEN_KEY)).toBe("new-token");
      expect((onRefreshed.mock.calls[0][0] as CustomEvent).detail).toBe("new-token");
      expect(onSessionExpired).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(TOKEN_REFRESHED_EVENT, onRefreshed);
    }
  });

  it("also refreshes and replays for apiFetchBlob", async () => {
    const blob = new Blob(["x"]);
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (url === REFRESH_URL) return json(200, { access_token: "new-token" });
      if (authOf(init) === "Bearer new-token") {
        return { ok: true, status: 200, blob: async () => blob, headers: new Headers() } as Response;
      }
      return json(401, { detail: "Token expired" });
    });

    const result = await apiFetchBlob("/v1/tts", { token: "old-token" });

    expect(result.blob).toBe(blob);
    expect(refreshCalls()).toHaveLength(1);
  });

  it.each([401, 403])("logs out when the refresh itself is rejected with %d", async (status) => {
    mockApi(async () => json(status, { detail: "Account is disabled" }));

    await expect(apiFetch("/v1/things", { token: "old-token" })).rejects.toMatchObject({
      status: 401,
    });

    expect(refreshCalls()).toHaveLength(1);
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it("logs out when the refresh fails with a network error", async () => {
    mockApi(async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(apiFetch("/v1/things", { token: "old-token" })).rejects.toMatchObject({
      status: 401,
    });

    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it("replays only once: a 401 on the replay logs out without another refresh", async () => {
    vi.mocked(fetch).mockImplementation(async (url) =>
      url === REFRESH_URL
        ? json(200, { access_token: "new-token" })
        : json(401, { detail: "nope" }),
    );

    await expect(apiFetch("/v1/things", { token: "old-token" })).rejects.toMatchObject({
      status: 401,
    });

    expect(vi.mocked(fetch).mock.calls).toHaveLength(3);
    expect(refreshCalls()).toHaveLength(1);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it("shares one refresh between concurrent 401s", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mockApi(async () => {
      await gate;
      return json(200, { access_token: "new-token" });
    });

    const requests = Array.from({ length: 5 }, (_, i) =>
      apiFetch(`/v1/things/${i}`, { token: "old-token" }),
    );
    await vi.waitFor(() => expect(refreshCalls()).toHaveLength(1));
    release();

    await expect(Promise.all(requests)).resolves.toHaveLength(5);
    expect(refreshCalls()).toHaveLength(1);
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it("replays with an already-refreshed stored token instead of refreshing again", async () => {
    sessionStorage.setItem(TOKEN_KEY, "new-token");
    mockApi();

    await expect(apiFetch("/v1/things", { token: "old-token" })).resolves.toEqual({ ok: true });

    expect(refreshCalls()).toHaveLength(0);
  });

  describe("replay identity guard (#53 review)", () => {
    const jwt = (claims: Record<string, unknown>) =>
      `h.${btoa(JSON.stringify(claims)).replace(/=+$/, "")}.s`;
    const mine = jwt({ sub: "1", active_tenant_id: "10", exp: 2e9 });

    function mockServer(accepts: string, refresh?: () => Promise<Response>) {
      vi.mocked(fetch).mockImplementation(async (url, init) => {
        if (url === REFRESH_URL && refresh) return refresh();
        return authOf(init) === `Bearer ${accepts}`
          ? json(200, { ok: true })
          : json(401, { detail: "Token expired" });
      });
    }

    it("replays with a newer stored token of the same user and org", async () => {
      const newer = jwt({ sub: "1", active_tenant_id: "10", exp: 2e9 + 1 });
      sessionStorage.setItem(TOKEN_KEY, newer);
      mockServer(newer);

      await expect(apiFetch("/v1/things", { token: mine })).resolves.toEqual({ ok: true });
      expect(refreshCalls()).toHaveLength(0);
    });

    it.each([
      ["another org (switchOrg)", { sub: "1", active_tenant_id: "20", exp: 2e9 }],
      ["another user", { sub: "2", active_tenant_id: "10", exp: 2e9 }],
    ])("does not replay with a stored token for %s", async (_label, claims) => {
      const other = jwt(claims);
      sessionStorage.setItem(TOKEN_KEY, other);
      mockServer(other);

      await expect(apiFetch("/v1/things", { token: mine })).rejects.toMatchObject({
        status: 401,
      });
      // Only the original request went out: no replay as someone else.
      expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
    });

    it("does not replay with a token swapped in for another org mid-refresh", async () => {
      const other = jwt({ sub: "1", active_tenant_id: "20", exp: 2e9 });
      sessionStorage.setItem(TOKEN_KEY, mine);
      mockServer(other, async () => {
        sessionStorage.setItem(TOKEN_KEY, other); // switchOrg lands meanwhile
        return json(200, { access_token: jwt({ sub: "1", active_tenant_id: "10" }) });
      });

      await expect(apiFetch("/v1/things", { token: mine })).rejects.toMatchObject({
        status: 401,
      });
      expect(vi.mocked(fetch).mock.calls).toHaveLength(2); // original + refresh
    });

    it("replays with the token its own refresh minted, even if the org changed", async () => {
      // The API may re-derive the active org on refresh; that token was minted
      // from the caller's own, so it is still the caller's session.
      const minted = jwt({ sub: "1", active_tenant_id: "99", exp: 2e9 });
      sessionStorage.setItem(TOKEN_KEY, mine);
      mockServer(minted, async () => json(200, { access_token: minted }));

      await expect(apiFetch("/v1/things", { token: mine })).resolves.toEqual({ ok: true });
    });
  });

  it("records the local receive time alongside a refreshed token", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_234_567);
    mockApi();
    try {
      await apiFetch("/v1/things", { token: "old-token" });
      expect(sessionStorage.getItem(TOKEN_RECEIVED_AT_KEY)).toBe("1234567");
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it("does not refresh an unauthenticated request", async () => {
    mockApi();

    await expect(apiFetch("/v1/things")).rejects.toMatchObject({ status: 401 });

    expect(refreshCalls()).toHaveLength(0);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it("never recurses: a 401 from the refresh endpoint makes exactly one refresh call", async () => {
    vi.mocked(fetch).mockResolvedValue(json(401, { detail: "Token expired" }));

    await expect(refreshAccessToken("old-token")).resolves.toBeNull();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      REFRESH_URL,
      expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer old-token" } }),
    );
    // Rejection is reported to the caller, not acted on here.
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe("old-token");
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it("rejects (rather than resolving null) on a transient 5xx", async () => {
    vi.mocked(fetch).mockResolvedValue(json(503, { detail: "unavailable" }));

    await expect(refreshAccessToken("old-token")).rejects.toMatchObject({ status: 503 });
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe("old-token");
  });

  it("does not resurrect a session that was logged out while the refresh was in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.mocked(fetch).mockImplementation(async () => {
      await gate;
      return json(200, { access_token: "new-token" });
    });

    const pending = refreshAccessToken("old-token");
    sessionStorage.removeItem(TOKEN_KEY); // logout
    release();

    await expect(pending).resolves.toBeNull();
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});

describe("apiFetchBlob", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the response's blob and headers on success", async () => {
    const blob = new Blob(["audio bytes"]);
    const headers = new Headers({ "X-Language": "en" });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => blob,
      headers,
    } as unknown as Response);

    const result = await apiFetchBlob("/v1/tts", { method: "POST", body: { text: "hi" } });

    expect(result.blob).toBe(blob);
    expect(result.headers.get("X-Language")).toBe("en");
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8000/v1/tts",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "hi" }),
      }),
    );
  });

  it("throws an ApiError on a non-ok response instead of trying to read a blob", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ detail: "Text too long" }),
    } as Response);

    await expect(apiFetchBlob("/v1/tts")).rejects.toMatchObject({
      message: "Text too long",
      status: 400,
    });
  });

  it("GETs with a Bearer token and no body", async () => {
    const blob = new Blob(["bytes"]);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => blob,
      headers: new Headers(),
    } as unknown as Response);

    await apiFetchBlob("/v1/tts/1", { token: "abc123" });

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8000/v1/tts/1",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer abc123" },
        body: undefined,
      }),
    );
  });

  it("passes a FormData body through untouched, without a Content-Type header", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob(["bytes"]),
      headers: new Headers(),
    } as unknown as Response);
    const form = new FormData();
    form.append("file", "contents");

    await apiFetchBlob("/v1/upload", { method: "POST", body: form });

    const call = vi.mocked(fetch).mock.calls[0];
    const init = call[1] as RequestInit;
    expect(init.headers).toEqual({});
    expect(init.body).toBe(form);
  });

  describe("global 401 handling (#46)", () => {
    it("clears the stored token and dispatches the session-expired event on a 401", async () => {
      sessionStorage.setItem(TOKEN_KEY, "stale-token");
      const onSessionExpired = vi.fn();
      window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ detail: "Not authenticated" }),
      } as Response);

      try {
        await expect(apiFetchBlob("/v1/tts")).rejects.toMatchObject({
          message: "Not authenticated",
          status: 401,
        });

        expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
        expect(onSessionExpired).toHaveBeenCalledTimes(1);
      } finally {
        window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
      }
    });

    it("does NOT clear the token or dispatch the event for a non-401 error", async () => {
      sessionStorage.setItem(TOKEN_KEY, "still-valid-token");
      const onSessionExpired = vi.fn();
      window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ detail: "boom" }),
      } as Response);

      try {
        await expect(apiFetchBlob("/v1/tts")).rejects.toMatchObject({ status: 500 });

        expect(sessionStorage.getItem(TOKEN_KEY)).toBe("still-valid-token");
        expect(onSessionExpired).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
      }
    });
  });
});
