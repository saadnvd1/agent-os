// Starting one stack item as a task: off the default branch, or stacked on
// its parent's pushed branch at the exact commit fetched.

import {
  db,
  itemIds,
  stackQueries as q,
  type Session,
  type StackItemRow,
  type StackRow,
} from "../db";
import { getProject } from "../projects";
import { requireClient } from "../lumifyhub/connection";
import { promptFromCard } from "../lumifyhub/task-cards";
import { createTask } from "../tasks";
import { run } from "../tasks/gh";
import { expandHome } from "../tasks/session";
import { itemName } from "./guard";
import { outputOf } from "./git";

async function stackedBase(
  parent: StackItemRow,
  repo: string,
  items: StackItemRow[],
  item: StackItemRow
) {
  const session = db
    .prepare(`SELECT * FROM sessions WHERE id = ?`)
    .get(parent.session_id) as Session | undefined;
  const branch = session?.branch_name;
  if (!branch) throw new Error(`${itemName(parent)} has no branch to stack on`);
  // The branch must be on ORIGIN: the PR's base is the remote branch, and a
  // child cut from unpushed commits opens a PR whose diff includes them.
  await run("git", ["fetch", "origin", branch], repo).catch(
    (error: unknown) => {
      throw new Error(
        `${branch} is not on origin: ${outputOf(error).slice(0, 200)}`
      );
    }
  );
  const tip = (
    await run("git", ["rev-parse", `origin/${branch}`], repo)
  ).trim();
  const also = itemIds(item.also_item_ids)
    .map((id) => items.find((i) => i.id === id))
    .filter((i): i is StackItemRow => !!i && i.status !== "merged")
    .map(itemName);
  return {
    branch,
    tip,
    stack: { pr: parent.pr_number, name: itemName(parent), also },
  };
}

// The task already running for this card, if any.
export function existingTask(cardId: string): string | null {
  const row = db
    .prepare(
      `SELECT id FROM sessions WHERE lh_card_id = ? AND task_status = 'running'
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(cardId) as { id: string } | undefined;
  return row?.id ?? null;
}

function linkTask(item: StackItemRow, sessionId: string, note: string | null) {
  const session = db
    .prepare(`SELECT base_branch FROM sessions WHERE id = ?`)
    .get(sessionId) as { base_branch: string | null } | undefined;
  q.updateItem(db, item.id, {
    status: "running",
    session_id: sessionId,
    base_branch: session?.base_branch ?? item.base_branch,
    note,
  });
}

// After a restart: an item caught between its claim and its task either
// has its task (link it) or never got one (plan it again).
export function reconcileStarting(): void {
  const rows = db
    .prepare(`SELECT * FROM stack_items WHERE status = 'starting'`)
    .all() as StackItemRow[];
  for (const item of rows) {
    const sessionId = item.session_id ?? existingTask(item.lh_card_id);
    if (sessionId) linkTask(item, sessionId, null);
    else q.updateItem(db, item.id, { status: "planned" });
  }
}

// Claims the item ('starting') before anything is created, and records the
// task the moment its row exists, so a restart never starts a card twice.
export async function startItem(
  stack: StackRow,
  item: StackItemRow
): Promise<void> {
  const existing = existingTask(item.lh_card_id);
  if (existing) {
    linkTask(
      item,
      existing,
      "Linked to the task already running for this card"
    );
    return;
  }
  const project = getProject(stack.project_id);
  if (!project) throw new Error("The stack's project is gone");
  q.updateItem(db, item.id, { status: "starting", error: null });
  const repo = expandHome(project.working_directory);
  const items = q.items(db, stack.id);
  const parent = items.find((i) => i.id === item.parent_item_id) ?? null;
  const base =
    parent && parent.status === "pr"
      ? await stackedBase(parent, repo, items, item)
      : undefined;
  const card = await requireClient().getCard(
    stack.lh_board_id,
    item.lh_card_id
  );
  try {
    await createTask({
      projectId: project.id,
      prompt: promptFromCard(card),
      cardId: card.id,
      base,
      onCreated: (sessionId) =>
        q.updateItem(db, item.id, {
          session_id: sessionId,
          base_branch: base?.branch ?? null,
          base_tip: base?.tip ?? null,
        }),
    });
  } catch (error) {
    // The task exists but its agent didn't launch: keep it, don't start
    // the card again.
    const sessionId = q.item(db, item.id)?.session_id;
    if (!sessionId) throw error;
    linkTask(item, sessionId, null);
    q.updateItem(db, item.id, {
      error: `The agent did not launch: ${outputOf(error).slice(0, 200)}`,
    });
    return;
  }
  linkTask(item, q.item(db, item.id)!.session_id!, null);
  q.updateItem(db, item.id, { error: null, attempts: 0 });
}
