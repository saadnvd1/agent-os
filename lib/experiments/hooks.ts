import { experimentOn } from ".";
import { EXPERIMENTS, type ExperimentId } from "./registry";

export type EndHow = "done" | "merged" | "recipe-settled";
export type EndHook = (sessionId: string, how: EndHow) => Promise<void> | void;

// What each experiment does when a session ends. An experiment adds itself
// here; one that is off is never called.
// Loaded on first use so the places that end sessions don't pull in the
// experiment's code. A hook does its own once-only check in the database: this
// process forgets what it has seen on a restart.
export const END_HOOKS: Partial<Record<ExperimentId, EndHook>> = {
  "learning-cards": async (id, how) =>
    (await import("../learning-cards/analyze")).analyzeSession(id, how),
};

// A merge is seen again on every poll; each session is handed on once. A
// recipe run settling is its own event: its session has usually ended already.
const seen = new Set<string>();
export const resetEndHooks = () => seen.clear();

// Called where sessions end. Never makes the caller wait or fail.
export function sessionEnded(sessionId: string, how: EndHow): Promise<void> {
  const key = how === "recipe-settled" ? `${sessionId}:settled` : sessionId;
  if (seen.has(key)) return Promise.resolve();
  seen.add(key);
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
