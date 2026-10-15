import type Database from "better-sqlite3";
import { partOf, type PartTable } from "./columns";
import { writePart } from "./write";

// Copies values onto a session's moved columns where it has none yet: a
// column that already holds a value, and a null to copy, are left alone.
// Names that aren't moved columns are the caller's to write.
export function fillMissing(
  db: Database.Database,
  sessionId: string,
  values: Record<string, string | number | null | undefined>
): void {
  const byTable = new Map<PartTable, string[]>();
  for (const [column, value] of Object.entries(values)) {
    const table = partOf(column);
    if (!table || value === null || value === undefined) continue;
    byTable.set(table, [...(byTable.get(table) ?? []), column]);
  }
  db.transaction(() => {
    for (const [table, columns] of byTable) {
      const current = db
        .prepare(`SELECT ${columns.join(", ")} FROM session_rows WHERE id = ?`)
        .get(sessionId) as Record<string, unknown> | undefined;
      if (!current) continue;
      const patch = Object.fromEntries(
        columns
          .filter((c) => current[c] === null)
          .map((c) => [c, values[c]] as const)
      );
      writePart(db, table, sessionId, patch as never);
    }
  })();
}
