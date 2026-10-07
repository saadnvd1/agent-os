/**
 * Where a move in this process has got to, for the UI to show while the
 * request runs. Keyed by the session being moved; the arriving half
 * (importTask) reports under the bundle's move id, which on a move back here
 * is the mirror's id, so both halves land on the same entry. Memory only:
 * a move outlives a restart as its row's 'moving', not as this.
 */

export type MoveStepState = "pending" | "active" | "done" | "failed";

export interface MoveProgress {
  to: string;
  steps: { key: string; label: string; state: MoveStepState }[];
  error: string | null;
  finished: boolean;
  at: number;
}

const KEEP_MS = 10 * 60 * 1000;
const g = globalThis as unknown as {
  __agentosMoveProgress?: Map<string, MoveProgress>;
};
const entries = (g.__agentosMoveProgress ??= new Map<string, MoveProgress>());

export function moveSteps(direction: "out" | "in", machine: string) {
  return direction === "out"
    ? [
        ["save", "Saving uncommitted work"],
        ["push", "Pushing the branch"],
        ["conversation", "Packing up the conversation"],
        ["arrive", `Recreating the worktree on ${machine} and resuming`],
      ]
    : [
        ["export", `${machine} stops the agent and pushes the branch`],
        ["worktree", "Recreating the worktree here"],
        ["conversation", "Carrying the conversation over"],
        ["resume", "Resuming the agent here"],
        ["confirm", `Telling ${machine} it moved`],
      ];
}

export function startProgress(id: string, to: string, steps: string[][]): void {
  const now = Date.now();
  for (const [k, p] of entries) if (now - p.at > KEEP_MS) entries.delete(k);
  entries.set(id, {
    to,
    steps: steps.map(([key, label]) => ({ key, label, state: "pending" })),
    error: null,
    finished: false,
    at: now,
  });
}

/** Everything before `key` is done and `key` is under way. */
export function stepProgress(id: string, key: string): void {
  const p = entries.get(id);
  const at = p?.steps.findIndex((s) => s.key === key) ?? -1;
  if (!p || p.finished || at < 0) return;
  p.steps.forEach((s, i) => {
    s.state = i < at ? "done" : i === at ? "active" : "pending";
  });
  p.at = Date.now();
}

export function finishProgress(id: string, error?: unknown): void {
  const p = entries.get(id);
  if (!p) return;
  p.finished = true;
  p.at = Date.now();
  if (error) {
    p.error = error instanceof Error ? error.message : String(error);
    const active = p.steps.find((s) => s.state === "active");
    if (active) active.state = "failed";
  } else {
    for (const s of p.steps) s.state = "done";
  }
}

export const getProgress = (id: string): MoveProgress | null =>
  entries.get(id) ?? null;
