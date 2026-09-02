/** Shapes shared across more than one page -- previously each page re-declared
 * its own copy (found drifting: AvailablePluginsPage's `Installation` was
 * missing `requires_services`, RagPipelinesPage's `KnowledgeBase` was a
 * hand-picked subset of KnowledgeBasesPage's). Centralized so an API shape
 * change only needs updating once. */

export interface Installation {
  installation_id: string;
  plugin_id: string;
  version: string | null;
  status: string;
  enabled: boolean;
  installed_at: string;
  last_updated_at: string;
  name: string;
  display_name: string;
  description: string | null;
  current_version: string | null;
  pricing_model: string;
  base_tier: string;
  category_id: string | null;
  author: string | null;
  requires_services: string[];
}

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
}

/** Just enough of a team to populate a sharing picker -- the full `Team`
 * shape (member_count etc., see TeamsPage.tsx) isn't needed for this.
 * Shared by KnowledgeBasesPage and RagPipelinesPage's team-visibility UI. */
export interface TeamOption {
  id: number;
  name: string;
}
