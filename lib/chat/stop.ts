/**
 * Stopping a chat's agent between turns, never in the middle of one: for a
 * move to another machine and for a stack's Land. The caller holds the chat
 * first (./hold), so nothing queued starts a new turn while this waits for
 * the running one to end. Then its worker closes, and the agent with it.
 */

import { chatStateNow, stopChat } from "./runner";
import { waitForExit } from "./worker/client";
import { registry } from "./registry";

export type ChatStop = { stopped: true } | { stopped: false; reason: string };

export interface StopOptions {
  // How long a running turn may take to end before this gives up.
  waitMs: number;
  sleep?: (ms: number) => Promise<void>;
  // Called once, when it finds a turn running and starts waiting.
  onWait?: () => void;
}

const POLL_MS = 500;
const defaultSleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

const minutes = (ms: number) => {
  const m = Math.round(ms / 60_000);
  return m >= 1 ? `${m} min` : `${Math.round(ms / 1000)}s`;
};

export async function stopChatAtTurnEnd(
  sessionId: string,
  { waitMs, sleep = defaultSleep, onWait }: StopOptions
): Promise<ChatStop> {
  for (let waited = 0; ; waited += POLL_MS) {
    let state;
    try {
      // A worker still starting (for a send from before the hold) is asked
      // once it's up, not taken for none.
      await registry.connecting.get(sessionId);
      state = await chatStateNow(sessionId);
    } catch {
      return {
        stopped: false,
        reason: "its chat worker is running but isn't answering",
      };
    }
    // An approval or a question: the turn ends only once someone answers.
    if (state === "waiting")
      return {
        stopped: false,
        reason:
          "its agent is waiting on an answer in the chat; answer it first",
      };
    if (state !== "running") {
      if (state) {
        stopChat(sessionId);
        await waitForExit(sessionId);
      }
      return { stopped: true };
    }
    if (waited >= waitMs)
      return {
        stopped: false,
        reason: `its agent's turn was still running after ${minutes(waitMs)}; try again once it ends`,
      };
    if (waited === 0) onWait?.();
    await sleep(POLL_MS);
  }
}

export type TurnStop =
  { stopped: true; killed: boolean } | { stopped: false; reason: string };

export interface TurnStopOptions {
  // How long the turn gets to end after the interrupt before its agent is
  // killed.
  graceMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const TURN_POLL_MS = 250;
// Idle has to hold this long: the CLI answers an interruption with a short
// turn of its own, which the host cuts short, and that must be over too.
const SETTLE_MS = 2500;

// The one way every caller (the stop button, the orchestrator's stop, aos
// stop, a restack) ends the turn in progress. The turn is interrupted, even
// while the model is thinking before any tool call; if it hasn't ended within
// the grace period the agent is killed. The conversation and worktree are
// kept, and the next message runs as the next turn.
export async function stopChatTurn(
  sessionId: string,
  { graceMs = 8000, sleep = defaultSleep }: TurnStopOptions = {}
): Promise<TurnStop> {
  let state;
  try {
    await registry.connecting.get(sessionId);
    state = await chatStateNow(sessionId);
  } catch {
    return {
      stopped: false,
      reason: "its chat worker is running but isn't answering",
    };
  }
  if (!state || state === "idle") return { stopped: true, killed: false };
  // Its agent is asked a question: killing it would lose the card.
  if (state === "waiting")
    return {
      stopped: false,
      reason:
        "it's waiting on an approval or question in its chat; answer or dismiss that first",
    };
  const sendsAtStop = registry.live.get(sessionId)?.activity.sends ?? 0;
  registry.live
    .get(sessionId)
    ?.worker.command({ type: "interrupt", hard: true });
  let idleFor = 0;
  for (let waited = 0; waited < graceMs + SETTLE_MS; waited += TURN_POLL_MS) {
    await sleep(TURN_POLL_MS);
    // A message sent meanwhile has started a new turn: not ours to kill.
    if ((registry.live.get(sessionId)?.activity.sends ?? 0) !== sendsAtStop)
      return { stopped: true, killed: false };
    const now = await chatStateNow(sessionId).catch(
      () => "unreachable" as const
    );
    if (now === null || now === "idle") {
      idleFor += TURN_POLL_MS;
      if (idleFor >= SETTLE_MS) return { stopped: true, killed: false };
    } else idleFor = 0;
    if (waited >= graceMs && idleFor === 0) break;
  }
  stopChat(sessionId);
  await waitForExit(sessionId);
  return { stopped: true, killed: true };
}
