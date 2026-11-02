// Client-safe. What the "Add leads" sheet sends for the leads ticked: each
// starts as a new chat or adopts one of the workspace's chats.
export const NEW_CHAT = "new";

export interface LeadPick {
  kind: string;
  // NEW_CHAT, or the id of the chat to adopt.
  source: string;
}

export interface AddPlan {
  kinds: string[];
  adopt: { sessionId: string; kind: string }[];
  // How many leads the button promises: the Tech lead counts the first time.
  count: number;
}

export function addPlan(
  hasLeads: boolean,
  picks: readonly LeadPick[]
): AddPlan {
  const seen = new Set<string>();
  const kept = picks.filter((p) => !seen.has(p.kind) && seen.add(p.kind));
  return {
    kinds: kept.filter((p) => p.source === NEW_CHAT).map((p) => p.kind),
    adopt: kept
      .filter((p) => p.source !== NEW_CHAT)
      .map((p) => ({ sessionId: p.source, kind: p.kind })),
    count: kept.length + (hasLeads ? 0 : 1),
  };
}

export const addLabel = (plan: AddPlan, hasLeads: boolean): string =>
  plan.count === 0
    ? "Tick a lead to add"
    : !hasLeads && plan.count === 1
      ? "Add the Tech lead"
      : `Add ${plan.count} lead${plan.count === 1 ? "" : "s"}`;
