import type Database from "better-sqlite3";
import { PART_COLUMNS, SESSION_ROW_COLUMNS, type PartTable } from "./columns";

const ALIAS: Record<PartTable, string> = {
  session_tasks: "t",
  session_prs: "pr",
  session_plans: "pl",
  session_placement: "pp",
  session_pauses: "pa",
};

// `session_rows`: a session with each moved column read from its own table,
// in the order of SESSION_ROW_COLUMNS (the flat shape a session row always
// had). A column with a default (peer_mirror) keeps it. Rebuild it in any
// migration that adds a sessions column. `parts` is the split as that
// migration knew it; a column on both sessions and a part (before the old
// columns were dropped) is read from the part.
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
  const onSessions = new Set(sessionColumns);
  const known = new Set(SESSION_ROW_COLUMNS);
  const names = [
    ...SESSION_ROW_COLUMNS.filter((c) => source.has(c) || onSessions.has(c)),
    ...sessionColumns.filter((c) => !known.has(c)),
  ];
  const select = names
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
