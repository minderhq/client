import { useCallback, useState } from "react";

import { apiFetch } from "./api";
import { useAuth } from "./auth";
import { type AsyncResource, useAsyncResource } from "./useAsyncResource";
import { useTokenRef } from "./useTokenRef";

export type IntendedUse = "docs_qa" | "team_knowledge" | "tool_automation" | "website_chatbot";
export type TeamMode = "solo" | "team";
export type StepState = "pending" | "done" | "dismissed";

/** `GET/PATCH /v1/onboarding`: the caller's own onboarding state in the active
 * organization. Typed by hand, like `Readiness` (readiness.ts): the synced
 * OpenAPI snapshot doesn't carry the route yet. `created_at` is null until
 * something has been stored for the caller (their first visit). */
export interface Onboarding {
  intended_use: IntendedUse | null;
  team_mode: TeamMode | null;
  /** Step id → state. Step ids are this client's own vocabulary. */
  checklist: Record<string, StepState>;
  skipped: boolean;
  ask_intro: boolean;
  created_at: string | null;
  updated_at: string | null;
}

/** A partial update: the server merges `checklist` per step. */
export type OnboardingChanges = Partial<
  Pick<Onboarding, "intended_use" | "team_mode" | "checklist" | "skipped">
>;

/** The checklist entry that hides the whole "Getting started" card. */
export const CARD_STEP = "getting_started";

export function patchOnboarding(token: string, changes: OnboardingChanges): Promise<Onboarding> {
  return apiFetch<Onboarding>("/v1/onboarding", { method: "PATCH", body: changes, token });
}

/** The caller's onboarding state plus `update`, which PATCHes and then shows
 * the server's answer. Idle while logged out (the endpoint needs a workspace
 * token). */
export function useOnboarding(): AsyncResource<Onboarding> & {
  update: (changes: OnboardingChanges) => Promise<void>;
} {
  const { token, sessionKey } = useAuth();
  const tokenRef = useTokenRef();
  const resource = useAsyncResource<Onboarding>(
    (signal) => apiFetch<Onboarding>("/v1/onboarding", { signal, token }),
    { deps: [sessionKey], enabled: Boolean(token) },
  );
  // Keyed by session so an org switch never shows the previous org's answer.
  const [saved, setSaved] = useState<{ key: string; state: Onboarding } | null>(null);
  const update = useCallback(
    async (changes: OnboardingChanges) => {
      setSaved({ key: sessionKey, state: await patchOnboarding(tokenRef.current, changes) });
    },
    [sessionKey, tokenRef],
  );
  return {
    ...resource,
    data: saved?.key === sessionKey ? saved.state : resource.data,
    update,
  };
}

const markedThisSession = new Set<string>();

/** Record that the caller did `step` (e.g. got their first answer), at most
 * once per session. Fire-and-forget: a failure only means Home shows the step
 * as not done yet. */
export function markOnboardingStep(token: string, sessionKey: string, step: string): void {
  const key = `${sessionKey}:${step}`;
  if (!token || markedThisSession.has(key)) return;
  markedThisSession.add(key);
  patchOnboarding(token, { checklist: { [step]: "done" } }).catch(() => {
    markedThisSession.delete(key);
  });
}

/** Steps each intro answer (owner decision O1) moves to the front, in order. */
const BOOST: Record<IntendedUse | TeamMode, string[]> = {
  docs_qa: ["upload", "ask"],
  team_knowledge: ["knowledge_base", "invite"],
  tool_automation: ["ask"],
  website_chatbot: ["knowledge_base", "assistant"],
  team: ["invite"],
  solo: [],
};

/** Order checklist steps by the caller's intro answers. `model` stays first:
 * nothing else works without one. A solo user gets "invite" last. Unanswered
 * questions leave the default order. */
export function orderSteps<T extends { id: string }>(
  steps: T[],
  intendedUse: IntendedUse | null | undefined,
  teamMode: TeamMode | null | undefined,
): T[] {
  const boosted = [
    "model",
    ...(intendedUse ? BOOST[intendedUse] : []),
    ...(teamMode ? BOOST[teamMode] : []),
  ];
  const rank = (id: string) => {
    if (teamMode === "solo" && id === "invite") return Number.MAX_SAFE_INTEGER;
    const i = boosted.indexOf(id);
    return i === -1 ? boosted.length : i;
  };
  // Array.prototype.sort is stable, so unboosted steps keep their order.
  return [...steps].sort((a, b) => rank(a.id) - rank(b.id));
}
