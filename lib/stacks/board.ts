// A linked board's cards, read as planner input.

import { db, type Project } from "../db";
import { requireClient } from "../lumifyhub/connection";
import { linkedWorkspaceFor } from "../lumifyhub/links";
import { cardUrl } from "../lumifyhub/urls";
import type { LhCard, LhList } from "../lumifyhub/types";
import type { PlanCard } from "./plan";

export interface BoardCards {
  cards: LhCard[];
  plan: PlanCard[];
  cardUrl: (cardId: string) => string | null;
}

// Cards in a done (completed) list are done; cancelled and backlog lists
// are left out of the stack, and hold whatever they block.
export function toPlanCards(
  cards: LhCard[],
  lists: LhList[],
  running: Map<string, string>
): PlanCard[] {
  const category = new Map(lists.map((l) => [l.id, l.category]));
  return cards.map((card) => {
    const cat = category.get(card.list_id);
    const excluded =
      cat === "canceled"
        ? "Cancelled"
        : cat === "backlog"
          ? "In the backlog"
          : null;
    return {
      id: card.id,
      ticket: card.ticket,
      title: card.title,
      blockedBy: (card.blocked_by ?? []).map((b) => b.id),
      done: !!card.completed || cat === "completed",
      excluded,
      sessionId: running.get(card.id) ?? null,
    };
  });
}

// {card id: session id} for tasks still running from this board's cards.
function runningTasks(boardId: string): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT id, lh_card_id FROM sessions
       WHERE lh_board_id = ? AND lh_card_id IS NOT NULL AND task_status = 'running'`
    )
    .all(boardId) as Array<{ id: string; lh_card_id: string }>;
  return new Map(rows.map((r) => [r.lh_card_id, r.id]));
}

export function boardOf(project: Project): string {
  if (!project.lh_board_id) throw new Error("This project has no linked board");
  return project.lh_board_id;
}

export async function readBoard(project: Project): Promise<BoardCards> {
  const boardId = boardOf(project);
  const client = requireClient();
  const [cards, lists] = await Promise.all([
    client.listCards(boardId),
    client.listLists(boardId),
  ]);
  let slug: string | null = null;
  try {
    slug = linkedWorkspaceFor(project).lh_workspace_slug;
  } catch {
    slug = null;
  }
  return {
    cards,
    plan: toPlanCards(cards, lists, runningTasks(boardId)),
    cardUrl: (id) =>
      slug ? cardUrl(client.baseUrl, slug, project.lh_board_page_id, id) : null,
  };
}
