import type Database from "better-sqlite3";
import { PART_COLUMNS, type PartTable } from "./columns";

const ALIAS: Record<PartTable, string> = {
  session_tasks: "t",
  session_prs: "pr",
  session_plans: "pl",
  session_placement: "pp",
  session_pauses: "pa",
};

// `session_rows`: the sessions table with each moved column read from its own
// table, under the same names and in the same order, so a row is the flat
// session it always was. A column with a default on sessions
// (peer_mirror) keeps it. Rebuild it in any migration that adds a sessions
// column. `parts` is the split as that migration knew it.
export function createSessionRowsView(
  db: Database.Database,
  parts: Record<PartTable, readonly string[]> = PART_COLUMNS
): void {
  const source = new Map<string, string>();
  for (const table of Object.keys(parts) as PartTable[])
    for (const c of parts[table]) source.set(c, ALIAS[table]);
  const sessionColumns = (
    db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]
  ).map((c) => c.name);
  const select = sessionColumns
    .map((c) => {
      const alias = source.get(c);
      if (!alias) return `s.${c}`;
      return c === "peer_mirror"
        ? `COALESCE(${alias}.${c}, 0) AS ${c}`
        : `${alias}.${c} AS ${c}`;
    })
    .join(", ");
  const joins = (Object.keys(parts) as PartTable[])
    .map((t) => `LEFT JOIN ${t} ${ALIAS[t]} ON ${ALIAS[t]}.session_id = s.id`)
    .join(" ");
  db.exec(`DROP VIEW IF EXISTS session_rows`);
  db.exec(
    `CREATE VIEW session_rows AS SELECT ${select} FROM sessions s ${joins}`
  );
}
