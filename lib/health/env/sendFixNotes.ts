import { db } from "@/lib/db";
import { MIN } from "../types";
import { fixFor } from "./fixText";
import { classById } from "./classes";
import type { EnvFailureRow } from "./types";

// A note this late is about something the session has moved on from.
export const STALE_MS = 120 * MIN;

export interface NoteDeps {
  send: (sessionId: string, body: string) => Promise<void>;
  // Waiting on a person: an approval or a question.
  blocked: (sessionId: string, role: "orchestrator" | null) => boolean;
}

interface Target {
  role: "orchestrator" | null;
  archived_at: string | null;
  task_status: string | null;
  pause_state: string | null;
}

const settle = (id: number, why: string) =>
  db
    .prepare(`UPDATE env_failures SET nudge_skipped = ? WHERE id = ?`)
    .run(why, id);

export const noteBody = (r: EnvFailureRow, fix: string): string => {
  const label = classById(r.class)?.label ?? r.class;
  const cmd = r.command ? ` (\`${r.command.slice(0, 100)}\`)` : "";
  return `Environment: ${label}${cmd}. ${fix}`;
};

// Each session hears each class's fix once: the row is claimed before the
// send, so a failed send is lost rather than repeated. A paused session or
// one waiting on a person is looked at again next tick.
export async function sendFixNotes(
  now: number,
  deps: NoteDeps
): Promise<number> {
  const rows = db
    .prepare(
      `SELECT * FROM env_failures WHERE nudged_at IS NULL AND nudge_skipped IS NULL
       ORDER BY id`
    )
    .all() as EnvFailureRow[];
  let sent = 0;
  for (const r of rows) {
    const fix = fixFor(r.class);
    if (!fix) {
      settle(r.id, "no fix");
      continue;
    }
    const s = db
      .prepare(
        `SELECT role, archived_at, task_status, pause_state FROM session_rows WHERE id = ?`
      )
      .get(r.session_id) as Target | undefined;
    if (!s || s.archived_at || (s.task_status && s.task_status !== "running")) {
      settle(r.id, "gone");
      continue;
    }
    if (now - r.first_at > STALE_MS) {
      settle(r.id, "stale");
      continue;
    }
    if (s.pause_state || deps.blocked(r.session_id, s.role)) continue;
    db.prepare(`UPDATE env_failures SET nudged_at = ? WHERE id = ?`).run(
      now,
      r.id
    );
    try {
      await deps.send(r.session_id, noteBody(r, fix));
      sent++;
    } catch (error) {
      console.error(`[env-failures] note to ${r.session_id} failed:`, error);
    }
  }
  return sent;
}
