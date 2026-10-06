/**
 * The stack planner, ported from dispatch's `plan_stack`. Pure: a board's
 * cards in, the order they can start in out, each with the blocker it stacks
 * on.
 *
 * The parent is the open blocker DEEPEST in the chain, so a card blocked by
 * A and C (C itself on B on A) sits on C and so on all three. A second
 * blocker that is not an ancestor of the parent is still waited for, and named
 * in `also`: its work is NOT in the child's base until it merges.
 *
 * A blocker that is open but outside the plan (cancelled, or a card the
 * listing did not include) holds the card, and everything on it, rather than
 * starting it without that work underneath.
 */

export interface PlanCard {
  id: string;
  ticket: string | null;
  title: string;
  blockedBy: string[];
  done: boolean;
  // Cancelled or otherwise left out of the stack.
  excluded?: string | null;
  // A task already working on this card.
  sessionId?: string | null;
}

export type PlanStatus = "planned" | "held" | "running" | "done" | "excluded";

export interface PlanItem {
  cardId: string;
  ticket: string | null;
  title: string;
  // Open blockers, by card id.
  blockers: string[];
  parent: string | null;
  also: string[];
  status: PlanStatus;
  sessionId: string | null;
  note: string | null;
  depth: number;
}

export function ticketNumber(ticket: string | null): number {
  const hit = /(\d+)$/.exec(ticket ?? "");
  return hit ? Number(hit[1]) : 0;
}

const byTicket = (a: PlanCard, b: PlanCard) =>
  ticketNumber(a.ticket) - ticketNumber(b.ticket) ||
  (a.ticket ?? "").localeCompare(b.ticket ?? "") ||
  a.title.localeCompare(b.title);

export class StackCycleError extends Error {}

export function planStack(cards: PlanCard[]): PlanItem[] {
  const sorted = [...cards].sort(byTicket);
  const cardById = new Map(sorted.map((c) => [c.id, c]));
  const name = (id: string) => {
    const card = cardById.get(id);
    return card?.ticket || card?.title || id;
  };
  const items = new Map<string, PlanItem>();
  for (const card of sorted) {
    const blockers = [...new Set(card.blockedBy)]
      .filter((b) => b !== card.id && !cardById.get(b)?.done)
      .sort((a, b) => {
        const ca = cardById.get(a);
        const cb = cardById.get(b);
        return ca && cb ? byTicket(ca, cb) : ca ? -1 : cb ? 1 : 0;
      });
    const status: PlanStatus = card.done
      ? "done"
      : card.excluded
        ? "excluded"
        : card.sessionId
          ? "running"
          : "planned";
    items.set(card.id, {
      cardId: card.id,
      ticket: card.ticket,
      title: card.title,
      blockers,
      parent: null,
      also: [],
      status,
      sessionId: card.sessionId ?? null,
      note: status === "excluded" ? (card.excluded ?? null) : null,
      depth: 0,
    });
  }

  const live = new Set(
    [...items.values()]
      .filter((i) => i.status === "planned" || i.status === "running")
      .map((i) => i.cardId)
  );
  const order: string[] = [];
  const placed = new Set<string>();
  let waiting = [...items.values()].filter((i) => live.has(i.cardId));
  while (waiting.length) {
    const ready = waiting.filter((i) =>
      i.blockers.every((b) => placed.has(b) || !live.has(b))
    );
    if (!ready.length) {
      throw new StackCycleError(
        "The blocked-by graph has a cycle: " +
          waiting.map((i) => name(i.cardId)).join(", ")
      );
    }
    for (const item of ready) place(item);
    waiting = waiting.filter((i) => !placed.has(i.cardId));
  }

  function place(item: PlanItem) {
    const inside = item.blockers.filter((b) => live.has(b));
    const outside = item.blockers.filter((b) => !live.has(b));
    const held = inside.filter((b) => items.get(b)!.status === "held");
    if (item.status === "planned" && (outside.length || held.length)) {
      item.status = "held";
      item.note = `Blocked by ${[...outside, ...held].map(name).join(", ")}, which is open but not part of this stack`;
    }
    item.depth = inside.length
      ? 1 + Math.max(...inside.map((b) => items.get(b)!.depth))
      : 0;
    if (inside.length) {
      const index = new Map(order.map((id, n) => [id, n]));
      const parent = inside.reduce((best, b) => {
        const [db, dbest] = [items.get(b)!.depth, items.get(best)!.depth];
        return db > dbest || (db === dbest && index.get(b)! > index.get(best)!)
          ? b
          : best;
      });
      const chain = new Set<string>();
      for (let node: string | null = parent; node; ) {
        chain.add(node);
        node = items.get(node)!.parent;
      }
      item.parent = parent;
      item.also = inside.filter((b) => !chain.has(b));
    }
    order.push(item.cardId);
    placed.add(item.cardId);
  }

  const rank = new Map(order.map((id, n) => [id, n]));
  return [...items.values()].sort(
    (a, b) => (rank.get(a.cardId) ?? -1) - (rank.get(b.cardId) ?? -1)
  );
}

// A sentence for the UI about what a waiting card waits on.
export function waitsOn(
  blockers: Array<{ ticket: string | null; title: string; hasPR: boolean }>
): string | null {
  const missing = blockers.filter((b) => !b.hasPR);
  if (!missing.length) return null;
  return `Waits on ${missing.map((b) => b.ticket || b.title).join(", ")}'s PR`;
}
