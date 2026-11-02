/** The fork watcher: looks at open children, delivers results, runs waits. */

import { db } from "../db";
import { admitQueued } from "./start";
import { childrenOf } from "./ledger";
import { deliverDue } from "./deliver";
import { lookAtChild } from "./settle";
import { tickForkWaits } from "./waits";
import { forksOn } from "./options";
import { sweepForks } from "./scratch";
import type { ChildRow } from "./types";

const EVERY_MS = 5000;
let running = false;
let timer: NodeJS.Timeout | null = null;
let kicked = false;
const SWEEP_EVERY_MS = 10 * 60_000;
let sweptAt = 0;

// Folders of children whose session closed after they settled, or a crash.
async function sweepClosed(now: number): Promise<void> {
  if (now - sweptAt < SWEEP_EVERY_MS) return;
  sweptAt = now;
  const live = db.prepare(
    `SELECT 1 FROM session_children c
     LEFT JOIN sessions s ON s.id = c.child_session_id
     WHERE c.child_session_id = ?
       AND (c.state != 'settled' OR (s.id IS NOT NULL AND s.archived_at IS NULL))`
  );
  await sweepForks((id) => !!live.get(id)).catch((error) =>
    console.error("[forks] sweep:", error)
  );
}

export async function forksTick(now = Date.now()): Promise<void> {
  if (running || !forksOn()) return;
  running = true;
  try {
    const open = db
      .prepare(`SELECT * FROM session_children WHERE state != 'settled'`)
      .all() as ChildRow[];
    for (const row of open) {
      try {
        await lookAtChild(row, now);
      } catch (error) {
        console.error(`[forks] child ${row.child_session_id}:`, error);
      }
    }
    for (const parent of new Set(open.map((c) => c.parent_session_id)))
      if (childrenOf(parent).some((c) => c.state === "queued"))
        await admitQueued(parent);
    await tickForkWaits(now);
    await deliverDue(now);
    await sweepClosed(now);
  } finally {
    running = false;
  }
}

export function kickForks(): void {
  if (kicked) return;
  kicked = true;
  setImmediate(() => {
    kicked = false;
    void forksTick();
  });
}

export function startForkWatcher(): void {
  if (timer) return;
  timer = setInterval(() => void forksTick(), EVERY_MS);
  timer.unref();
}
