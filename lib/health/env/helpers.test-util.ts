import { db } from "@/lib/db";
import { updateSessionRow } from "@/lib/db/session-parts/rows";

export function seedSession(
  id: string,
  patch: Record<string, string | number | null> = {}
): void {
  db.prepare(
    `INSERT OR REPLACE INTO sessions (id, name, tmux_name, working_directory)
     VALUES (?, ?, ?, '/repo')`
  ).run(id, `session ${id}`, `t-${id}`);
  updateSessionRow(db, id, { view: "chat", ...patch });
}

export function resetEnv(): void {
  db.exec(`DELETE FROM env_failures`);
  for (const r of db
    .prepare(`SELECT id FROM sessions WHERE id LIKE 'env-%'`)
    .all() as { id: string }[])
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(r.id);
}
