import { apiFetch } from "./api";

/** A pending cross-tenant SAME_AS candidate (#1125): the graph found two
 * high-similarity entities owned by DIFFERENT tenants and recorded a
 * CANDIDATE_SAME_AS edge. It is NEVER merged into a real SAME_AS link until
 * both owning tenants approve (dual-control) — or an instance admin acts for
 * the instance. `approvals` lists who has approved so far. */
export interface CandidateSameAs {
  id: string;
  entity_a: string;
  entity_b: string;
  label?: string | null;
  confidence?: number | null;
  evidence?: string | null;
  owner_a?: string | null;
  owner_b?: string | null;
  approvals: string[];
  created_at?: string | null;
}

export interface CandidateListResponse {
  success: boolean;
  candidates: CandidateSameAs[];
}

export interface CandidateReviewResponse {
  success: boolean;
  id: string;
  status: string; // pending | approved | rejected
  entity_a?: string | null;
  entity_b?: string | null;
  approvals: string[];
}

export interface CandidateDetectResponse {
  success: boolean;
  candidates: number;
}

/** List pending candidates. A regular caller sees only candidates where they
 * are one of the two owning tenants; a platform operator sees all. */
export function fetchCandidates(token: string, signal?: AbortSignal) {
  return apiFetch<CandidateListResponse>("/v1/graph-rag/graph/candidates", {
    token,
    signal,
  });
}

/** Approve or reject one candidate under dual-control. A real SAME_AS link is
 * written only once BOTH owning tenants approve; a single approval leaves it
 * pending. Either party (or an admin) may reject. */
export function reviewCandidate(
  id: string,
  decision: "approve" | "reject",
  token: string,
) {
  return apiFetch<CandidateReviewResponse>(
    `/v1/graph-rag/graph/candidates/${encodeURIComponent(id)}/review`,
    { method: "POST", body: { decision }, token },
  );
}

/** Platform-operator-only cross-tenant scan that records new CANDIDATE_SAME_AS
 * edges for high-similarity entities owned by different tenants. Returns how
 * many candidates were recorded. */
export function detectCandidates(token: string) {
  return apiFetch<CandidateDetectResponse>(
    "/v1/graph-rag/graph/candidates/detect",
    { method: "POST", token },
  );
}
