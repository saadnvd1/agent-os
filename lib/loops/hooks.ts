import type { Stop } from "./decideStop";
import type { LoopRow } from "./types";

// Where other features plug into the loop without the loop importing them
// (the plain-English health reports and operating modes, BR02-19, set these
// once they land; until then they are empty).
export interface LoopHooks {
  // A cycle's checks and analysis are stored: ask for a report, fire and
  // forget. The summary is the analyst's own words, not evidence.
  onCycleSettled?: (input: {
    taskId: string;
    cycleId: number;
    analystSummary: string | null;
  }) => void;
  // The loop began or ended on a task: the operating mode follows.
  onStart?: (loop: LoopRow) => void;
  onStop?: (
    loop: LoopRow,
    stop: Stop,
    pendingInstruction: string | null
  ) => void;
}

let hooks: LoopHooks = {};

export const setLoopHooks = (next: LoopHooks) => {
  hooks = next;
};

// A hook never breaks the loop.
export function callHook<K extends keyof LoopHooks>(
  name: K,
  ...args: Parameters<NonNullable<LoopHooks[K]>>
): void {
  try {
    (hooks[name] as ((...a: unknown[]) => void) | undefined)?.(...args);
  } catch (error) {
    console.error(`Loop hook ${name}:`, error);
  }
}
