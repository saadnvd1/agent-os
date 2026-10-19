// Which task statuses are over, and which of those resurrect will bring
// back. One rule for the Restore button and for resurrectSession.
// Client-safe: no database.

// A dropped or done task keeps its branch and conversation, so it restores.
export const RESTORABLE_TASK = new Set(["dropped", "done"]);

// A merged task's work is in the base branch; a moved one runs elsewhere.
// Neither restores, and neither is finished again.
const OVER_TASK = new Set([...RESTORABLE_TASK, "merged", "moved"]);

export const isRestorableTask = (status: string | null | undefined) =>
  !!status && RESTORABLE_TASK.has(status);

export const isOverTask = (status: string | null | undefined) =>
  !!status && OVER_TASK.has(status);
