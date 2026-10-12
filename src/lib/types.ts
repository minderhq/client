/** Shapes shared across more than one page -- previously each page re-declared
 * its own copy (found drifting: AvailablePluginsPage's `Installation` was
 * missing `requires_services`, RagPipelinesPage's `KnowledgeBase` was a
 * hand-picked subset of KnowledgeBasesPage's). Centralized so an API shape
 * change only needs updating once. */

/** A marketplace installation record. Typed from the gateway spec in
 * lib/marketplace.ts (#119); re-exported here for existing importers. */
export type { Installation } from "./marketplace";

import type { DataPolicy } from "./modelDefaults";

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  embedding_model: string;
  llm_model: string;
  document_count: number;
  vector_count: number;
  created_at: string;
  // Tenancy/sharing (#1046, Phase 4): owner_id/visibility have existed on
  // the backend since tenancy-and-correlation.md's Phase 1, but this client
  // never surfaced them until team-scoped sharing gave visibility an
  // editable, user-relevant meaning. team_id is only set when
  // visibility === "team".
  owner_id?: string | null;
  visibility?: "private" | "team" | "shared" | null;
  team_id?: number | null;
  // #2525 (ADR model-selection D5): "local_only" = this KB's content is never
  // sent to a cloud model. Absent on a backend older than #2525.
  data_policy?: DataPolicy | null;
}

/** Just enough of a team to populate a sharing picker -- the full `Team`
 * shape (member_count etc., see TeamsPage.tsx) isn't needed for this.
 * Shared by KnowledgeBasesPage and RagPipelinesPage's team-visibility UI. */
export interface TeamOption {
  id: number;
  name: string;
}
