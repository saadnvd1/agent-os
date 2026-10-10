import type Database from "better-sqlite3";

// Every write to a watched table bumps its row in change_versions, from a
// trigger, so it's seen whoever wrote it: a route, a chat worker, `aos`. The
// status hub compares versions once a second while someone is watching and
// pushes the names of the tables that moved (lib/status/hub.ts); browsers
// refetch what they show from those tables instead of polling.

// The tables migration 45 watches. A migration's list never changes once
// shipped: a table watched later gets its own migration and list.
export const TABLES_WATCHED_45 = [
  "sessions",
  "projects",
  "groups",
  "workspaces",
  "hosts",
  "stacks",
  "stack_items",
  "bus_messages",
  "schedules",
  "schedule_runs",
  "orchestrator_asks",
  "dev_servers",
] as const;

export const TABLES_WATCHED_50 = ["task_queue"] as const;

// Every table any migration watches, for the browser's topic map to cover.
export const WATCHED_TABLES: readonly string[] = [
  ...TABLES_WATCHED_45,
  ...TABLES_WATCHED_50,
];

export function installChangeTriggers(
  db: Database.Database,
  tables: readonly string[]
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS change_versions (
      topic TEXT PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 0
    )
  `);
  for (const table of tables) {
    if (!/^[a-z_]+$/.test(table)) throw new Error(`bad table name ${table}`);
    for (const [suffix, event] of [
      ["ins", "INSERT"],
      ["upd", "UPDATE"],
      ["del", "DELETE"],
    ])
      db.exec(
        `CREATE TRIGGER IF NOT EXISTS change_${table}_${suffix}
           AFTER ${event} ON ${table}
         BEGIN
           INSERT INTO change_versions (topic, version) VALUES ('${table}', 1)
           ON CONFLICT(topic) DO UPDATE SET version = version + 1;
         END`
      );
  }
}

export function readChangeVersions(db: Database.Database): Map<string, number> {
  const rows = db
    .prepare(`SELECT topic, version FROM change_versions`)
    .all() as { topic: string; version: number }[];
  return new Map(rows.map((r) => [r.topic, r.version]));
}

// The tables whose version moved between two reads (a new one counts).
export function movedTables(
  before: Map<string, number>,
  after: Map<string, number>
): string[] {
  return [...after]
    .filter(([topic, version]) => before.get(topic) !== version)
    .map(([topic]) => topic);
}

// Says which tables moved since it was last called; the first call only
// takes the baseline.
export function changeWatcher(db: () => Database.Database): () => string[] {
  let last: Map<string, number> | null = null;
  return () => {
    const now = readChangeVersions(db());
    const moved = last ? movedTables(last, now) : [];
    last = now;
    return moved;
  };
}
