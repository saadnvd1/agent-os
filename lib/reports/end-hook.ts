// The task-end trigger, decoupled from the code that ends tasks: finishing a
// task calls taskEnded(), and the report generator is plugged in at server
// start (hooks.ts), so ending a task never reaches for gh or a model on its own.

let onEnd: ((sessionId: string) => void) | null = null;

export const setTaskEndHook = (fn: ((sessionId: string) => void) | null) => {
  onEnd = fn;
};

export function taskEnded(sessionId: string): void {
  try {
    onEnd?.(sessionId);
  } catch (error) {
    console.error(`Report at the end of ${sessionId}:`, error);
  }
}
