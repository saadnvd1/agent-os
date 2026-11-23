// Whether a session's work is over, so its claim holds nothing: done (on the
// Done shelf), dropped, archived or merged. One rule for the collector, the
// release at cleanup and the start check.

import { getDb } from "../db";
import type { Released } from "./types";

export interface EndedFacts {
  archived_at?: string | null;
  settled_at?: string | null;
  task_status?: string | null;
  pr_status?: string | null;
}

const ENDED_TASK = new Set(["done", "dropped", "merged", "moved"]);

// How the session ended, or null while it is live.
export function endedHow(s: EndedFacts): Released | null {
  if (s.pr_status === "merged" || s.task_status === "merged") return "merged";
  if (
    s.archived_at ||
    s.settled_at ||
    s.pr_status === "closed" ||
    (s.task_status && ENDED_TASK.has(s.task_status))
  )
    return "done";
  return null;
}

// Session ids (of the given ones) that have ended. A claim's session that
// isn't in the table at all is gone, which is ended too.
export function endedSessions(ids: string[]): Set<string> {
  const out = new Set<string>();
  if (!ids.length) return out;
  const rows = getDb()
    .prepare(
      `SELECT id, archived_at, settled_at, task_status, pr_status
         FROM session_rows WHERE id IN (${ids.map(() => "?").join(",")})`
    )
    .all(...ids) as ({ id: string } & EndedFacts)[];
  const seen = new Set(rows.map((r) => r.id));
  for (const r of rows) if (endedHow(r)) out.add(r.id);
  for (const id of ids) if (!seen.has(id)) out.add(id);
  return out;
}
