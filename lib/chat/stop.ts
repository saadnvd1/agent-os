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
