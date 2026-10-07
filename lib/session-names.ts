// Names sessions had before they were renamed (migration 34).

import { db } from "./db";

export function recordPreviousName(sessionId: string, name: string): void {
  if (!name.trim()) return;
  db.prepare(`INSERT INTO session_names (session_id, name) VALUES (?, ?)`).run(
    sessionId,
    name
  );
}

// Every session's previous names, newest first.
export function previousNames(): Map<string, string[]> {
  const rows = db
    .prepare(`SELECT session_id, name FROM session_names ORDER BY id DESC`)
    .all() as { session_id: string; name: string }[];
  const byId = new Map<string, string[]>();
  for (const r of rows) {
    const names = byId.get(r.session_id) ?? [];
    if (!names.includes(r.name)) names.push(r.name);
    byId.set(r.session_id, names);
  }
  return byId;
}
