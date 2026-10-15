import type Database from "better-sqlite3";
import { PART_TABLES, partOf, type PartTable } from "./columns";
import { writePart } from "./write";

type Value = string | number | null | undefined;

function split(row: Record<string, Value>) {
  const own: Record<string, Value> = {};
  const parts = new Map<PartTable, Record<string, Value>>();
  for (const [column, value] of Object.entries(row)) {
    if (value === undefined) continue;
    const table = partOf(column);
    if (!table) own[column] = value;
    else parts.set(table, { ...parts.get(table), [column]: value });
  }
  return { own, parts };
}

const writeParts = (
  db: Database.Database,
  id: string,
  parts: Map<PartTable, Record<string, Value>>
) => {
  for (const table of PART_TABLES) {
    const patch = parts.get(table);
    if (patch) writePart(db, table, id, patch as never);
  }
};

// A session row in its flat shape (sessions columns and moved ones together),
// written to sessions and the part tables. A moved column left null or unset
// makes no part row. For seeds, imports and tests.
export function insertSessionRow(
  db: Database.Database,
  row: Record<string, Value> & { id: string }
): void {
  const { own, parts } = split(row);
  for (const [table, patch] of parts) {
    for (const [c, v] of Object.entries(patch))
      if (v === null || (c === "peer_mirror" && v === 0)) delete patch[c];
    if (Object.keys(patch).length === 0) parts.delete(table);
  }
  const columns = Object.keys(own);
  db.transaction(() => {
    db.prepare(
      `INSERT INTO sessions (${columns.join(", ")})
       VALUES (${columns.map((c) => `@${c}`).join(", ")})`
    ).run(own);
    writeParts(db, row.id, parts);
  })();
}

// Updates any of a session's columns by name, wherever each one lives.
export function updateSessionRow(
  db: Database.Database,
  id: string,
  patch: Record<string, Value>
): void {
  const { own, parts } = split(patch);
  const columns = Object.keys(own);
  db.transaction(() => {
    if (columns.length > 0)
      db.prepare(
        `UPDATE sessions SET ${columns.map((c) => `${c} = @${c}`).join(", ")}
          WHERE id = @__id`
      ).run({ ...own, __id: id });
    writeParts(db, id, parts);
  })();
}
