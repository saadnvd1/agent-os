// Who started a task and how. started_by is the session that started it (the
// calling task, chat or orchestrator; null for a person), parent_session_id
// the session it came from, started_via how it began.

import path from "path";
import { db } from "../db";

export type StartVia =
  | "session"
  | "orchestrator"
  | "person"
  | "plan"
  | "schedule"
  | "recipe"
  | "stack"
  | "remote";

export interface Starter {
  startedBy: string | null;
  parentSessionId: string | null;
  startedVia: StartVia;
  startedByDevice?: string | null;
}

export const PERSON: Starter = {
  startedBy: null,
  parentSessionId: null,
  startedVia: "person",
};

export const personStarter = (device?: string | null): Starter => ({
  ...PERSON,
  startedByDevice: device ?? null,
});

interface Caller {
  id: string;
  role: string | null;
}

// The session making the call: `from` when it names a real session, else the
// one whose worktree holds `cwd`. A project folder is shared by many
// sessions, so only a worktree identifies one, and only a task's: a cwd
// outside every known task worktree names nobody. Remaining trust: any local
// process can still name a task by its id or its worktree path, exactly as
// it could name one in `from`; this records who asked, it grants nothing
// (a piece it claims is that task's own plan's).
export function callerSession(input: {
  from?: unknown;
  cwd?: unknown;
}): Caller | null {
  if (typeof input.from === "string" && input.from) {
    const row = db
      .prepare(`SELECT id, role FROM sessions WHERE id = ?`)
      .get(input.from) as Caller | undefined;
    if (row) return row;
  }
  if (typeof input.cwd !== "string" || !path.isAbsolute(input.cwd)) return null;
  const cwd = path.resolve(input.cwd);
  const rows = db
    .prepare(
      `SELECT id, role, worktree_path FROM sessions
       WHERE worktree_path IS NOT NULL AND archived_at IS NULL
         AND task_status IS NOT NULL
         AND (host_id IS NULL OR host_id = 'local')`
    )
    .all() as (Caller & { worktree_path: string })[];
  let best: (Caller & { worktree_path: string }) | null = null;
  for (const r of rows) {
    const wt = path.resolve(r.worktree_path);
    if (
      (cwd === wt || cwd.startsWith(wt + path.sep)) &&
      (!best || wt.length > best.worktree_path.length)
    )
      best = r;
  }
  return best;
}

export function starterOf(
  caller: Caller | null,
  device?: string | null
): Starter {
  if (!caller) return personStarter(device);
  return {
    startedBy: caller.id,
    parentSessionId: caller.id,
    startedVia: caller.role === "orchestrator" ? "orchestrator" : "session",
  };
}

// The orchestrator that owns a session's work: follows started_by up to the
// first orchestrator, null when the chain ends at a person. It gives up after
// 6 hops (a deeper chain, or a cycle, counts as no orchestrator), so a bad
// row can never loop it.
export function orchestratorOf(startedBy: string | null | undefined) {
  const seen = new Set<string>();
  let id = startedBy ?? null;
  for (let hops = 0; id && hops < 6 && !seen.has(id); hops++) {
    seen.add(id);
    const row = db
      .prepare(`SELECT role, started_by FROM sessions WHERE id = ?`)
      .get(id) as
      | { role: string | null; started_by: string | null }
      | undefined;
    if (!row) return null;
    if (row.role === "orchestrator") return id;
    id = row.started_by;
  }
  return null;
}

export function recordStart(id: string, s: Starter): void {
  db.prepare(
    `UPDATE sessions SET started_by = ?, parent_session_id = (SELECT id FROM sessions WHERE id = ?), started_via = ?,
       started_by_device = COALESCE(?, started_by_device) WHERE id = ?`
  ).run(
    s.startedBy,
    s.parentSessionId,
    s.startedVia,
    s.startedByDevice ?? null,
    id
  );
}
