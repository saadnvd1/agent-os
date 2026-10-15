import type Database from "better-sqlite3";
import { PART_COLUMNS, type PartPatch, type PartTable } from "./columns";

type Value = string | number | null;

// A condition on the part row's current values, checked with the write in one
// transaction: every column must equal one of its listed values (null for
// "unset").
export type When<T extends PartTable> = {
  [C in keyof PartPatch<T>]?: Value | readonly Value[];
};

const sameAs = (current: unknown, wanted: Value | readonly Value[]): boolean =>
  (Array.isArray(wanted) ? (wanted as Value[]) : [wanted as Value]).some(
    (w) => (current ?? null) === w
  );

// The one writer of the part tables. Writes the patched columns to the part
// table, then mirrors the same values onto the legacy sessions columns, which
// stay until they are dropped (docs/decisions/2026-10-15-split-sessions-table.md):
// that UPDATE is the only dual-write, and the step that drops the columns
// deletes it. Returns whether it wrote (false: the session is gone or `when`
// no longer holds).
export function writePart<T extends PartTable>(
  db: Database.Database,
  table: T,
  sessionId: string,
  patch: PartPatch<T>,
  when?: When<T>
): boolean {
  const allowed = PART_COLUMNS[table] as readonly string[];
  const columns = Object.keys(patch).filter(
    (c) => (patch as Record<string, unknown>)[c] !== undefined
  );
  for (const c of [...columns, ...Object.keys(when ?? {})])
    if (!allowed.includes(c)) throw new Error(`${c} is not a ${table} column`);
  if (columns.length === 0) return false;

  const run = db.transaction((): boolean => {
    if (when && Object.keys(when).length > 0) {
      const current = db
        .prepare(
          `SELECT ${Object.keys(when).join(", ")} FROM session_rows WHERE id = ?`
        )
        .get(sessionId) as Record<string, unknown> | undefined;
      if (!current) return false;
      for (const [c, wanted] of Object.entries(when))
        if (!sameAs(current[c], wanted as Value | readonly Value[]))
          return false;
    }
    const values = { id: sessionId, ...(patch as Record<string, Value>) };
    const inserted = db
      .prepare(
        `INSERT INTO ${table} (session_id, ${columns.join(", ")})
         SELECT id, ${columns.map((c) => `@${c}`).join(", ")}
           FROM sessions WHERE id = @id
         ON CONFLICT(session_id) DO UPDATE SET
           ${columns.map((c) => `${c} = excluded.${c}`).join(", ")}`
      )
      .run(values);
    if (inserted.changes === 0) return false;
    db.prepare(
      `UPDATE sessions SET ${columns.map((c) => `${c} = @${c}`).join(", ")}
        WHERE id = @id`
    ).run(values);
    return true;
  });
  return run();
}
