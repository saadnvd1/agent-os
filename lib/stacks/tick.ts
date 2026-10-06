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
import { taskPR } from "../tasks";
import { planTick } from "./ready";
import { startItem } from "./start";
import { outputOf } from "./git";

const EVERY = 60_000;
const busy = new Set<string>();

const sessionOf = (id: string) =>
  db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as
    | Session
    | undefined;

async function refreshItem(item: StackItemRow): Promise<void> {
  if (!item.session_id || (item.status !== "running" && item.status !== "pr"))
    return;
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
  const pr = await taskPR(session);
  if (!pr) return;
  if (
    pr.state === "OPEN" &&
    (item.status !== "pr" || item.pr_number !== pr.number)
  ) {
    q.updateItem(db, item.id, { status: "pr", pr_number: pr.number });
  } else if (pr.state === "MERGED") {
    q.updateItem(db, item.id, {
      status: "merged",
      pr_number: pr.number,
      note: "Merged outside AgentOS: anything stacked on it was not restacked",
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

export async function tickStack(stack: StackRow): Promise<void> {
  if (busy.has(stack.id)) return;
  busy.add(stack.id);
  try {
    await refreshItems(stack.id);
    const fresh = q.get(db, stack.id);
    if (fresh?.status !== "running") return;
    const plan = planTick(q.items(db, stack.id), fresh.max_parallel);
    for (const { id, note } of plan.hold) {
      q.updateItem(db, id, { status: "held", note });
    }
    for (const id of plan.start) {
      const item = q.item(db, id)!;
      try {
        await startItem(fresh, item);
      } catch (error) {
        // Marked, not retried in a loop: its dependents are held next look.
        q.updateItem(db, id, {
          status: "failed",
          error: `Could not start: ${outputOf(error).slice(0, 300)}`,
        });
      }
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

export function tickSoon(stackId?: string): void {
  const run = stackId ? q.get(db, stackId) : null;
  void (run ? tickStack(run) : tickAll()).catch((error: unknown) =>
    console.error("[stacks] tick:", error)
  );
}

let timer: NodeJS.Timeout | null = null;

export function startStackWatcher(): void {
  if (timer) return;
  // A land cut short by a restart is not resumed on its own.
  db.prepare(
    `UPDATE stacks SET status = 'failed', progress = NULL,
       error = 'Landing was interrupted by a restart; land again to carry on'
     WHERE status = 'landing'`
  ).run();
  timer = setInterval(() => void tickAll(), EVERY);
  timer.unref();
  void tickAll();
}
