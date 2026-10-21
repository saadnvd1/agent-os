import { raiseAsk, AskRefused, taskSubject } from "../orchestrator/asks";
import { queueEventOnce } from "../orchestrator/events";
import { addNote } from "../orchestrator/notes";
import type { Stop } from "./decideStop";
import { callHook } from "./hooks";
import { getLoop, cyclesOf, moveCycle, stopLoopRow } from "./store";
import type { LoopRow, StopReason } from "./types";

export const REASON_LABEL: Record<StopReason, string> = {
  stopped: "stopped by you",
  blocked: "needs you",
  done: "all criteria met",
  repeat: "the same failure kept coming back",
  no_progress: "no progress",
  "limit:cycles": "reached its cycle limit",
  "limit:cost": "reached its cost cap",
  "limit:time": "reached its time limit",
};

// These raise an ask: the loop stopped short of done and someone has to
// decide. Done and the user's own stop don't.
const ASKS: StopReason[] = [
  "blocked",
  "repeat",
  "no_progress",
  "limit:cycles",
  "limit:cost",
  "limit:time",
];

// Ends a running loop once. The cycle in flight is closed, its undelivered
// instruction kept as the draft, the orchestrator told, an ask raised when
// someone has to decide, and the operating mode handed back.
export function finishLoop(
  loop: LoopRow,
  stop: Stop,
  opts: { taskName: string; now: number }
): boolean {
  if (!stopLoopRow(loop.id, stop.reason, stop.detail, opts.now)) return false;
  const last = cyclesOf(loop.id, { limit: 1 })[0];
  let pending: string | null = null;
  if (last) {
    pending = last.instruction;
    const unsent = ["claimed", "decided", "counting", "sending"] as const;
    if (unsent.includes(last.state as (typeof unsent)[number]))
      moveCycle(loop.id, last.n, [...unsent], {
        state: "stopped",
        endedAt: opts.now,
      });
  }
  const label = REASON_LABEL[stop.reason];
  const text = `Loop on ${opts.taskName}: ${label}${stop.detail && stop.reason !== "stopped" ? ` (${stop.detail})` : ""}.`;
  if (loop.workspaceId) {
    try {
      addNote(loop.workspaceId, text);
    } catch {}
    try {
      queueEventOnce(
        loop.workspaceId,
        `loop:${loop.sessionId}:${loop.id}:${stop.reason}`,
        loop.sessionId,
        text
      );
    } catch {}
    if (ASKS.includes(stop.reason)) {
      try {
        raiseAsk({
          workspaceId: loop.workspaceId,
          subject: taskSubject(loop.sessionId),
          kind: stop.askKind ?? "decision",
          title: `Loop on ${opts.taskName} ${label}`,
          detail: [
            stop.detail,
            pending ? `The next instruction was not sent:\n${pending}` : "",
          ]
            .filter(Boolean)
            .join("\n\n"),
        });
      } catch (error) {
        if (!(error instanceof AskRefused)) console.error("Loop ask:", error);
      }
    }
  }
  callHook("onStop", getLoop(loop.id) ?? loop, stop, pending);
  return true;
}
