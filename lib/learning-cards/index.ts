import { experimentOn } from "../experiments";
import { countEvent } from "../experiments/meter";
import { listCards, listPending, markShown } from "./store";
import {
  cardTitle,
  type Card,
  type PendingCardView,
  type RecipePayload,
} from "./types";

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

// Every pending card, or one workspace's. Reading it is not seeing the card:
// nothing is stamped as shown. Nothing while the experiment is off.
export function pendingCards(workspaceId?: string): PendingCardView[] {
  if (!experimentOn(ID)) return [];
  return listPending()
    .filter((c) => workspaceId === undefined || c.ws === workspaceId)
    .map((c) => ({
      id: c.id,
      sessionId: c.session_id,
      sessionName: c.session_name,
      workspaceId: c.ws,
      kind: c.kind,
      title: cardTitle(c),
      destination: c.destination,
      createdAt: c.created_at,
    }));
}
