/**
 * The watcher: every minute (and on demand) each running stack is looked at
 * once. Items move on from what their task and PR now say, anything on a dead
 * item is held, and ready items start up to the stack's cap. All state is in
 * the database, so a restart picks up where it stopped.
 */

import {
  db,
  stackQueries as q,
  type Session,
  type StackItemRow,
  type StackRow,
} from "../db";
import { signingOff, taskPR } from "../tasks";
import { planTick } from "./ready";
import { reconcileStarting, startItem } from "./start";
import { restackDescendants } from "./restack";
import { parentBranchOf } from "./guard";
import { outputOf } from "./git";

const EVERY = 60_000;
// A start that fails is tried again on the next looks, up to this many times.
export const START_ATTEMPTS = 3;
const busy = new Set<string>();

// Asked before each card starts; a reason holds the card (it stays planned
// and shows why). The orchestrator's brakes hook in here.
export type StartGate = (
  stackId: string,
  itemId: string
) => Promise<string | null>;
let startGate: StartGate | null = null;

export function setStartGate(gate: StartGate | null): void {
  startGate = gate;
}
const LIVE = new Set(["running", "pr"]);

const sessionOf = (id: string) =>
  db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as
    | Session
    | undefined;

async function refreshItem(item: StackItemRow): Promise<void> {
  if (!item.session_id || !LIVE.has(item.status)) return;
  const session = sessionOf(item.session_id);
  if (!session || session.task_status === "dropped") {
    q.updateItem(db, item.id, {
      status: "dropped",
      note: "Its task was dropped",
    });
    return;
  }
  if (session.task_status === "merged") {
    q.updateItem(db, item.id, { status: "merged" });
    return;
  }
  if (signingOff.has(session.id)) return;
  const pr = await taskPR(session);
  if (!pr) return;
  if (
    pr.state === "OPEN" &&
    (item.status !== "pr" || item.pr_number !== pr.number)
  ) {
    q.updateItem(db, item.id, { status: "pr", pr_number: pr.number });
  } else if (pr.state === "MERGED") {
    // Its children are moved by the reconciliation below.
    q.updateItem(db, item.id, {
      status: "merged",
      pr_number: pr.number,
      note: "Merged on GitHub, not signed off in AgentOS",
    });
  } else if (pr.state === "CLOSED" && item.status === "pr") {
    q.updateItem(db, item.id, {
      status: "failed",
      error: `PR #${pr.number} was closed`,
    });
  }
}

export async function refreshItems(stackId: string): Promise<void> {
  for (const item of q.items(db, stackId)) await refreshItem(item);
}

// Merged parents whose children still sit on their branch: a crash between
// the merge and the restack, or a merge done on GitHub. One that needs a
// human (has an error) is left to the Restack button.
export function parentsToRestack(
  items: StackItemRow[],
  branchOf: (parent: StackItemRow) => string | null
): StackItemRow[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const parents = new Map<string, StackItemRow>();
  for (const item of items) {
    const parent = item.parent_item_id ? byId.get(item.parent_item_id) : null;
    if (!parent || parent.status !== "merged") continue;
    if (!LIVE.has(item.status) || item.error || !item.base_tip) continue;
    const branch = branchOf(parent);
    if (branch && item.base_branch === branch) parents.set(parent.id, parent);
  }
  return [...parents.values()];
}

// Nothing left to start, wait on or merge: the stack is finished.
export function finishedStatus(
  items: StackItemRow[]
): "landed" | "failed" | null {
  const open = new Set(["planned", "held", "starting", "running", "pr"]);
  if (items.some((i) => open.has(i.status))) return null;
  return items.some((i) => i.status === "failed") ? "failed" : "landed";
}

export interface TickDeps {
  start: typeof startItem;
  restack: (parent: StackItemRow) => Promise<unknown>;
}

const defaults: TickDeps = { start: startItem, restack: restackDescendants };

async function startOrRetry(
  stack: StackRow,
  id: string,
  deps: TickDeps
): Promise<void> {
  const item = q.item(db, id)!;
  try {
    await deps.start(stack, item);
  } catch (error) {
    const attempts = item.attempts + 1;
    const reason = outputOf(error).slice(0, 300);
    // Transient failures (LumifyHub, a fetch) get another look; then it is
    // failed, and its dependents are held until someone presses Retry.
    q.updateItem(
      db,
      id,
      attempts < START_ATTEMPTS
        ? {
            status: "planned",
            attempts,
            error: `Start failed (try ${attempts} of ${START_ATTEMPTS}), trying again: ${reason}`,
          }
        : {
            status: "failed",
            attempts,
            error: `Could not start after ${attempts} tries: ${reason}`,
          }
    );
  }
}

export async function tickStack(
  stack: StackRow,
  deps: TickDeps = defaults
): Promise<void> {
  if (busy.has(stack.id)) return;
  busy.add(stack.id);
  try {
    await refreshItems(stack.id);
    for (const parent of parentsToRestack(
      q.items(db, stack.id),
      parentBranchOf
    )) {
      void deps
        .restack(parent)
        .catch((error: unknown) =>
          console.error(`[stacks] restack ${parent.id}:`, error)
        );
    }
    const fresh = q.get(db, stack.id);
    if (fresh?.status !== "running") return;
    const plan = planTick(q.items(db, stack.id), fresh.max_parallel);
    for (const { id, note } of plan.hold) {
      q.updateItem(db, id, { status: "held", note });
    }
    for (const id of plan.start) {
      const held = await startGate?.(fresh.id, id);
      if (held) {
        q.updateItem(db, id, { note: held });
        break;
      }
      await startOrRetry(fresh, id, deps);
    }
    const done = finishedStatus(q.items(db, stack.id));
    if (done) {
      q.update(db, stack.id, {
        status: done,
        landed_at: done === "landed" ? new Date().toISOString() : null,
        error: done === "failed" ? "Every card is done, but some failed" : null,
      });
    }
  } finally {
    busy.delete(stack.id);
  }
}

export async function tickAll(): Promise<void> {
  for (const stack of q.all(db).filter((s) => s.status === "running")) {
    await tickStack(stack).catch((error: unknown) =>
      console.error(`[stacks] tick ${stack.id}:`, error)
    );
  }
}

// Look at one stack (or all of them) now, without waiting for it.
export function tickSoon(stackId?: string): void {
  const stack = stackId ? q.get(db, stackId) : null;
  void (stack ? tickStack(stack) : tickAll()).catch((error: unknown) =>
    console.error("[stacks] tick:", error)
  );
}

// After a restart. A land cut short is paused with its progress kept: Land
// carries on from the first PR not yet merged.
export function recoverAfterRestart(): void {
  reconcileStarting();
  db.prepare(
    `UPDATE stacks SET status = 'paused',
       error = 'Landing was interrupted by a restart. Press Land to carry on.'
     WHERE status = 'landing'`
  ).run();
}

let timer: NodeJS.Timeout | null = null;

export function startStackWatcher(): void {
  if (timer) return;
  recoverAfterRestart();
  timer = setInterval(() => void tickAll(), EVERY);
  timer.unref();
  void tickAll();
}
