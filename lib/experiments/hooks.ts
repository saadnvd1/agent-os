import { experimentOn } from ".";
import { EXPERIMENTS, type ExperimentId } from "./registry";

export type EndHow = "done" | "merged" | "recipe-settled";
export type EndHook = (sessionId: string, how: EndHow) => Promise<void> | void;

// What each experiment does when a session ends. An experiment adds itself
// here; one that is off is never called.
export const END_HOOKS: Partial<Record<ExperimentId, EndHook>> = {};

// A merge is seen again on every poll; each session is handed on once.
const seen = new Set<string>();
export const resetEndHooks = () => seen.clear();

// Called where sessions end. Never makes the caller wait or fail.
export function sessionEnded(sessionId: string, how: EndHow): Promise<void> {
  if (seen.has(sessionId)) return Promise.resolve();
  seen.add(sessionId);
  return (async () => {
    await new Promise<void>((r) => setImmediate(r));
    for (const { id } of EXPERIMENTS) {
      const hook = END_HOOKS[id];
      if (!hook || !experimentOn(id)) continue;
      try {
        await hook(sessionId, how);
      } catch (error) {
        console.error(`[experiments] ${id} on ${sessionId}:`, error);
      }
    }
  })();
}
