/**
 * "Needs you" is a session that has waited on Saad for a minute. A timer
 * starts when it begins waiting and is cancelled by any change, so a quick
 * permission prompt that he answers never buzzes.
 */

import { pushNeedsYou } from "./events";
import { WAIT_MS } from "./policy";

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function noteWaiting(sessionId: string, waiting: boolean): void {
  const armed = timers.get(sessionId);
  if (!waiting) {
    if (armed) {
      clearTimeout(armed);
      timers.delete(sessionId);
    }
    return;
  }
  if (armed) return;
  const armedAt = Date.now();
  const timer = setTimeout(() => {
    timers.delete(sessionId);
    pushNeedsYou(sessionId, armedAt);
  }, WAIT_MS);
  timer.unref?.();
  timers.set(sessionId, timer);
}
