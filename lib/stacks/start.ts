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

export async function startItem(
  stack: StackRow,
  item: StackItemRow
): Promise<void> {
  const project = getProject(stack.project_id);
  if (!project) throw new Error("The stack's project is gone");
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
  const session = await createTask({
    projectId: project.id,
    prompt: promptFromCard(card),
    cardId: card.id,
    base,
  });
  q.updateItem(db, item.id, {
    status: "running",
    session_id: session.id,
    base_branch: session.base_branch,
    base_tip: base?.tip ?? null,
    error: null,
    note: null,
  });
}
