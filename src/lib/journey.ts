import type { IconName } from "../components/Icon";

/** The single source of truth for the RAG "golden path" — the KB → Upload →
 * Pipeline → Ask sequence a first-time user has to walk to get an answer.
 *
 * Before this existed the journey lived only inside HomePage.primaryAction and
 * keyed off KB/pipeline COUNTS alone (#1226/#1227): a KB with zero documents
 * counted as "ready", so the home card told you to build a pipeline over an
 * empty KB, you did, you asked, and you got a silent nothing. Both the home
 * suggestion and the on-page GoldenPathStepper now derive from the helpers
 * here, so "what's my next step" is computed one way everywhere. */

/** Minimal shape needed to judge readiness — both KnowledgeBasesPage's full
 * `KnowledgeBase` and RagPipelinesPage's picker subset satisfy it. */
export interface KbReadiness {
  document_count: number;
  vector_count: number;
}

/** A KB is "ready to query" once it holds at least one fully-ingested document
 * AND vectors for it. `document_count` alone isn't enough: an upload can 503 on
 * embedding (#77) leaving a KB that looks populated but has no searchable
 * vectors — a pipeline over it returns an empty/low-confidence answer with no
 * explanation. Requiring `vector_count > 0` is what makes "ready" mean it. */
export function kbReady(kb: KbReadiness): boolean {
  return kb.document_count > 0 && kb.vector_count > 0;
}

/** Live counts that drive the journey. `readyKbCount` (not `kbCount`) gates the
 * pipeline step — an empty KB can't usefully be queried. */
export interface JourneyCounts {
  kbCount: number;
  readyKbCount: number;
  pipelineCount: number;
}

export type JourneyStepKey = "kb" | "upload" | "pipeline" | "ask";

export interface JourneyStep {
  key: JourneyStepKey;
  /** Short label for the stepper. */
  label: string;
  /** Where clicking the step takes you. */
  to: string;
  icon: IconName;
}

/** The four steps, in order. `kb` and `upload` both live on /rag (create then
 * upload happen on the same page); `pipeline` and `ask` have their own routes. */
export const JOURNEY_STEPS: JourneyStep[] = [
  { key: "kb", label: "Knowledge base", to: "/rag", icon: "knowledge-bases" },
  { key: "upload", label: "Upload docs", to: "/rag", icon: "upload" },
  { key: "pipeline", label: "Pipeline", to: "/rag/pipelines", icon: "pipelines" },
  { key: "ask", label: "Ask", to: "/ask", icon: "ask" },
];

/** How many leading steps are DONE — which is also the index of the current
 * (first incomplete) step. 0 = no KB yet, 1 = KB but empty (Upload is next),
 * 2 = has documents (Pipeline is next), 3 = has a pipeline (ready to Ask).
 * `null` counts (not loaded yet) read as the very start. */
export function completedStepCount(counts: JourneyCounts | null): number {
  if (!counts || counts.kbCount === 0) return 0;
  if (counts.readyKbCount === 0) return 1;
  if (counts.pipelineCount === 0) return 2;
  return 3;
}

/** Per-step status relative to the current position, for the stepper's styling.
 * The terminal `ask` step never becomes "done" (asking isn't a persisted count)
 * — once everything before it is complete it stays the highlighted goal. */
export type JourneyStepStatus = "done" | "current" | "upcoming";

export function stepStatus(
  counts: JourneyCounts | null,
  index: number,
): JourneyStepStatus {
  const done = completedStepCount(counts);
  if (index < done) return "done";
  if (index === done) return "current";
  return "upcoming";
}

export interface PrimaryAction {
  to: string;
  icon: IconName;
  title: string;
  body: string;
}

/** The single most useful next step, derived from what's actually in this
 * installation — a first-time user with 0 knowledge bases and someone who
 * already has 12 pipelines running shouldn't see the same call to action.
 * Shared by HomePage's suggestion card and (via completedStepCount) the
 * on-page stepper, so they can never disagree. */
export function primaryAction(counts: JourneyCounts | null): PrimaryAction {
  switch (completedStepCount(counts)) {
    case 0:
      return {
        to: "/rag",
        icon: "knowledge-bases",
        title: "Create your first knowledge base",
        body: "Upload a document (PDF/TXT/MD) to start — every other RAG feature builds on this.",
      };
    case 1:
      return {
        to: "/rag",
        icon: "upload",
        title: "Upload a document",
        body: "Your knowledge base is empty — upload a PDF, TXT, or MD file so there's something to search over.",
      };
    case 2: {
      const n = counts!.readyKbCount;
      return {
        to: "/rag/pipelines",
        icon: "pipelines",
        title: "Build a pipeline",
        body: `You have ${n} knowledge base${n === 1 ? "" : "s"} ready — combine them into a pipeline to start asking questions.`,
      };
    }
    default: {
      const n = counts!.pipelineCount;
      return {
        to: "/ask",
        icon: "ask",
        title: "Ask a question",
        body: `Jump into Ask to query your ${n} pipeline${n === 1 ? "" : "s"} — answers cite their sources.`,
      };
    }
  }
}
