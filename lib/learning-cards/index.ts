import { experimentOn } from "../experiments";
import { countEvent } from "../experiments/meter";
import { listCards, markShown } from "./store";
import type { Card, RecipePayload } from "./types";

const ID = "learning-cards" as const;

// A session's pending cards. Nothing, and no work, while the experiment is off.
export function cardsFor(sessionId: string): Card[] {
  if (!experimentOn(ID)) return [];
  const cards = listCards(sessionId, "pending");
  for (const c of cards)
    if (markShown(c.id))
      countEvent(ID, "shown", {
        trigger: "card-view",
        sessionId,
        workspaceId: c.workspace_id,
        detail: c.kind,
      });
  return cards;
}

// The brief a pending recipe card drafted, so Edit needn't draft it again.
export function pendingRecipeDraft(sessionId: string) {
  if (!experimentOn(ID)) return undefined;
  const card = listCards(sessionId, "pending").find((c) => c.kind === "recipe");
  const p = card?.payload as RecipePayload | undefined;
  return p ? { brief: p.brief, summary: p.summary } : undefined;
}
