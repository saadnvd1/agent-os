/**
 * Stacks: a LumifyHub board's cards run as stacked tasks. A card starts once
 * every card it is blocked by has a PR up, on its parent's branch; children
 * are restacked when a parent merges, and Land merges the lot bottom-up.
 * Port of dispatch's `stack` / `land`; docs/stacks.md has the why.
 */

import { db, stackQueries as q, type StackRow } from "../db";
import { dropTask } from "../tasks";
import { createStack } from "./create";
import { landStack } from "./land";
import { restackItem } from "./restack";
import { tickSoon } from "./tick";
import { stackView } from "./view";
import type { StackView } from "./types";

export { previewStack } from "./create";
export { startStackWatcher, tickAll } from "./tick";
export type * from "./types";

function stackOrThrow(id: string): StackRow {
  const stack = q.get(db, id);
  if (!stack) throw new Error("Stack not found");
  return stack;
}

export function listStacks(): StackView[] {
  return q.all(db).map(stackView);
}

export function getStack(id: string): StackView {
  return stackView(stackOrThrow(id));
}

export async function startStack(opts: {
  projectId: string;
  maxParallel?: number;
}): Promise<StackView> {
  const stack = await createStack(opts);
  tickSoon(stack.id);
  return stackView(stack);
}

export function pauseStack(id: string): StackView {
  const stack = stackOrThrow(id);
  if (stack.status !== "running")
    throw new Error(`The stack is ${stack.status}`);
  q.update(db, id, { status: "paused" });
  return getStack(id);
}

// Resume a paused stack, or one whose land stopped, once it is sorted out.
export function resumeStack(id: string): StackView {
  const stack = stackOrThrow(id);
  if (stack.status !== "paused" && stack.status !== "failed") {
    throw new Error(`The stack is ${stack.status}`);
  }
  q.update(db, id, { status: "running", error: null });
  tickSoon(id);
  return getStack(id);
}

// Merges in the background; progress is on the stack row.
export function landInBackground(id: string): StackView {
  const stack = stackOrThrow(id);
  if (stack.status === "landing" || stack.status === "landed") {
    throw new Error(`The stack is already ${stack.status}`);
  }
  void landStack(id);
  return getStack(id);
}

export async function dropItem(
  stackId: string,
  itemId: string
): Promise<StackView> {
  const item = q.item(db, itemId);
  if (!item || item.stack_id !== stackId) throw new Error("Item not found");
  if (item.status === "merged" || item.status === "dropped") {
    throw new Error(`It is already ${item.status}`);
  }
  if (item.session_id && (item.status === "running" || item.status === "pr")) {
    await dropTask(item.session_id);
  }
  q.updateItem(db, itemId, {
    status: "dropped",
    note: "Dropped from the stack",
  });
  tickSoon(stackId);
  return getStack(stackId);
}

export async function retryRestack(
  stackId: string,
  itemId: string
): Promise<StackView> {
  const item = q.item(db, itemId);
  if (!item || item.stack_id !== stackId) throw new Error("Item not found");
  await restackItem(itemId);
  return getStack(stackId);
}
