import { changedFiles, mergeBase, trackedFiles } from "./changedFiles";
import { buildGraph } from "./importGraph";
import { selectChecks } from "./selectChecks";
import type { CheckScope } from "./types";

export type { Change, CheckScope } from "./types";
export { selectChecks } from "./selectChecks";

// What a task's pre-PR check has to cover, from what its branch changed.
export function checkScope(cwd: string, full = false): CheckScope {
  const base = mergeBase(cwd);
  if (!base)
    return {
      full: true,
      reason: "no merge base with main",
      changed: 0,
      lint: [],
      format: [],
      tests: [],
    };
  const files = trackedFiles(cwd);
  const changes = changedFiles(cwd, base);
  // Paths that moved or went away still resolve the imports that name them.
  const all = [
    ...new Set([
      ...files,
      ...changes.flatMap((c) => (c.from ? [c.path, c.from] : [c.path])),
    ]),
  ];
  return selectChecks({
    changes,
    files: all,
    graph: buildGraph(cwd, all),
    full,
  });
}
