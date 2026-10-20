/**
 * Settles open waits: nudges a target that went idle without answering,
 * wakes a waiter whose condition holds, whose deadline passed or whose
 * target ended. Replies settle in sendMessage; this covers the rest. It
 * reads status through statusOf, the same idle test the orchestrator uses.
 */

import type { Session } from "../../db";
import { db } from "../../db";
import { statusDetector } from "../../status-detector";
import { statusOf } from "../../orchestrator/facts";
import { queueEventOnce } from "../../orchestrator/events";
import { sessionWorkspace } from "../../schedules/store";
import { sendMessage } from "../index";
import { onKick } from "./kick";
import {
  claimClose,
  claimNudge,
  markSeenBusy,
  openWaits,
  type WaitRow,
} from "./store";
import {
  closedPrLine,
  endedLine,
  nudgeLine,
  orchestratorTimeoutLine,
  satisfiedLine,
  timeoutLine,
} from "./lines";

// A target that was never seen working is idle only this long after the
// wait opened: a chat turn can start and end between two looks, and a
// message may not have been picked up yet.
export const IDLE_GRACE_MS = 20_000;
// A terminal reads dead for a moment when tmux hiccups: twice in a row is gone.
const DEAD_LOOKS = 2;
const EVERY_MS = 5000;

const dead = new Map<string, number>();

const row = (id: string) =>
  db.prepare(`SELECT * FROM session_rows WHERE id = ?`).get(id) as
    Session | undefined;

// Why this session can no longer act on a wait, or null.
function endedHow(s: Session | undefined): string | null {
  if (!s) return "deleted";
  if (s.archived_at) return "archived";
  if (s.task_status === "moved" || s.task_status === "moving") return "moved";
  if (s.task_status && s.task_status !== "running") return s.task_status;
  return null;
}

async function tell(to: Session, line: string): Promise<void> {
  try {
    await sendMessage({
      fromId: null,
      fromLabel: "AgentOS",
      to: to.id,
      body: line,
      line,
    });
  } catch (error) {
    console.error(`[waits] couldn't tell ${to.name}:`, error);
  }
}

async function settle(w: WaitRow, waiter: Session, now: number): Promise<void> {
  const target = row(w.target_id);
  const end = endedHow(target);
  const prMerged =
    target?.pr_status === "merged" || target?.task_status === "merged";

  if (w.kind === "merged" && prMerged) {
    if (claimClose(w.id, "merged", null, now))
      await tell(waiter, satisfiedLine(target!, "merged", target!.pr_number));
    return;
  }
  if (w.kind === "merged" && target?.pr_status === "closed") {
    if (claimClose(w.id, "ended", null, now))
      await tell(waiter, closedPrLine(target, target.pr_number));
    return;
  }
  if (end || !target) {
    if (claimClose(w.id, "ended", null, now))
      await tell(
        waiter,
        endedLine(
          target ?? { id: w.target_id, name: "the session" },
          end ?? "deleted",
          w.request
        )
      );
    return;
  }

  const { status } = await statusOf(target);
  if (status === "dead") {
    const n = (dead.get(target.id) ?? 0) + 1;
    dead.set(target.id, n);
    if (n >= DEAD_LOOKS) {
      if (claimClose(w.id, "ended", null, now))
        await tell(
          waiter,
          endedLine(target, "its terminal is gone", w.request)
        );
      return;
    }
  } else dead.delete(target.id);

  if (status === "running") markSeenBusy(w.id, now);
  const idle =
    status === "idle" &&
    (w.seen_busy_at != null || now - w.created_at >= IDLE_GRACE_MS);

  if (w.kind === "idle" && idle) {
    if (claimClose(w.id, "idle", null, now))
      await tell(waiter, satisfiedLine(target, "idle"));
    return;
  }

  if (now >= w.deadline) {
    if (!claimClose(w.id, "timeout", null, now)) return;
    const is = status === "running" ? "still working" : status;
    await tell(
      waiter,
      timeoutLine(target, w.kind, w.deadline - w.created_at, w.request, is)
    );
    const workspace = sessionWorkspace(waiter);
    if (workspace && waiter.role !== "orchestrator")
      queueEventOnce(
        workspace,
        `wait-timeout:${w.id}`,
        waiter.id,
        orchestratorTimeoutLine(
          waiter.name,
          target.name,
          w.deadline - w.created_at,
          w.request
        )
      );
    return;
  }

  if (w.kind === "reply" && idle && !w.nudged_at && claimNudge(w.id, now))
    await tell(target, nudgeLine(waiter, w.request, w.message_id));
}

let running = false;

export async function waitsTick(now = Date.now()): Promise<void> {
  if (running) return;
  running = true;
  try {
    const waits = openWaits();
    if (!waits.length) return;
    await statusDetector.refreshCache();
    for (const w of waits) {
      try {
        const waiter = row(w.waiter_id);
        // A waiter that is gone has no one to tell.
        if (!waiter || endedHow(waiter)) {
          claimClose(w.id, "cancelled", null, now);
          continue;
        }
        await settle(w, waiter, now);
      } catch (error) {
        console.error(`[waits] wait ${w.id}:`, error);
      }
    }
  } finally {
    running = false;
  }
}

let timer: NodeJS.Timeout | null = null;
let kicked = false;

export function startWaitWatcher(): void {
  if (timer) return;
  timer = setInterval(() => void waitsTick(), EVERY_MS);
  timer.unref();
  onKick(() => {
    if (kicked) return;
    kicked = true;
    setImmediate(() => {
      kicked = false;
      void waitsTick();
    });
  });
}
