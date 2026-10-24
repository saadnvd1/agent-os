import { emit, type Live } from "./registry";
import { ModelWaitTracker } from "./model-wait";
import type { WorkerEvent } from "./worker/protocol";

// Keeps the model call the turn waits on current; the events that only feed
// it (prompt size, a retry) go no further.
export function trackModelWait(
  sessionId: string,
  live: Live,
  e: WorkerEvent
): boolean {
  const tracker = (live.waitTracker ??= new ModelWaitTracker());
  const changed = tracker.on(e);
  if (changed) {
    live.modelWait = tracker.wait;
    emit(sessionId, { type: "model_wait", wait: tracker.wait });
  }
  return e.type === "prompt_tokens" || e.type === "model_retry";
}
