import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { detectCandidates, fetchCandidates, reviewCandidate } from "./graphCandidates";

// These are thin apiFetch wrappers, but the URL shape, HTTP method, body, and
// (critically) the id encoding in reviewCandidate are real correctness surface:
// an un-encoded id with a slash or space would hit the wrong route. Drive the
// real apiFetch through a stubbed global fetch and assert the request it builds.

function okJson(value: unknown) {
  vi.mocked(fetch).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => value,
  } as Response);
}

function lastCall() {
  const call = vi.mocked(fetch).mock.calls[0];
  return { url: call[0] as string, init: call[1] as RequestInit };
}

describe("graphCandidates request building", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetchCandidates GETs the candidates route with the bearer token", async () => {
    okJson({ success: true, candidates: [] });
    await fetchCandidates("tok");
    const { url, init } = lastCall();
    expect(url).toBe("http://localhost:8000/v1/graph-rag/graph/candidates");
    expect(init.method).toBe("GET");
    expect(init.headers).toMatchObject({ Authorization: "Bearer tok" });
  });

  it("reviewCandidate POSTs the decision and URL-encodes the id", async () => {
    okJson({ success: true, id: "a/b", status: "pending", approvals: [] });
    await reviewCandidate("a/b c", "approve", "tok");
    const { url, init } = lastCall();
    // the id must be percent-encoded so a slash/space doesn't break the route
    expect(url).toBe(
      "http://localhost:8000/v1/graph-rag/graph/candidates/a%2Fb%20c/review",
    );
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ decision: "approve" }));
  });

  it("detectCandidates POSTs the detect route", async () => {
    okJson({ success: true, candidates: 3 });
    await detectCandidates("tok");
    const { url, init } = lastCall();
    expect(url).toBe(
      "http://localhost:8000/v1/graph-rag/graph/candidates/detect",
    );
    expect(init.method).toBe("POST");
  });
});
