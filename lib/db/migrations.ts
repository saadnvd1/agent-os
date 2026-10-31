import type Database from "better-sqlite3";
import type { Migration } from "./migration-types";
import { migrationFiles } from "./migrations.generated";

export type { Migration } from "./migration-types";

// HOW TO ADD A MIGRATION: add ONE file, lib/db/migrations/<key>.ts, and edit
// nothing else. The key is a UTC timestamp, never an integer id:
// "YYYYMMDDTHHMM_snake_name" (e.g. "20261014T0130_share_links"), and the file
// is named exactly the key:
//
//   import type { Migration } from "../migration-types";
//   export default {
//     key: "20261014T0130_share_links",
//     up: (db) => { ... },
//   } satisfies Migration;
//
// Hand-picked numbers collide when two tasks run in parallel and the loser is
// silently skipped on databases that already applied the winner. Ids 1..89 are
// legacy (files 0001_<name>.ts..0089_<name>.ts): they run first, by number, and
// never change. Timestamp keys run after them, in lexical order. Never edit a
// migration that has shipped; add a new one.
//
// lib/db/migrations.generated.ts is built from the folder by
// scripts/gen-migrations-index.mjs (npm runs it before dev, start, build,
// typecheck, lint and test) and is not committed. A duplicate id or key, or a
// file whose name does not match its id, throws when this module loads.
// lib/db/migrations.test.ts enforces the rest.
//
// A migration must leave the previous release runnable: an automatic update
// that isn't healthy rolls the code back but not the database (chat workers
// keep writing through the restart, so a restore would drop their work). Add
// columns and tables; don't rename or drop what the last release reads.

export const migrationKey = (m: Migration): string => m.key ?? String(m.id);
const migrationName = (m: Migration): string =>
  m.name ?? (m.key as string).replace(/^\d{8}T\d{4}_/, "");

const KEY_RE = /^\d{8}T\d{4}_[a-z0-9]+(_[a-z0-9]+)*$/;
const LEGACY_MAX = 89;

// The migrations in run order, checked against their file names: legacy ids by
// number, then timestamp keys lexically.
export function buildRegistry(files: Record<string, Migration>): Migration[] {
  const seen = new Map<string, string>();
  const list: Migration[] = [];
  for (const [file, m] of Object.entries(files)) {
    const where = `lib/db/migrations/${file}.ts`;
    if (!m || typeof m.up !== "function")
      throw new Error(`${where} must default-export { id|key, up }.`);
    let expected: string;
    if (m.key !== undefined) {
      if (!KEY_RE.test(m.key))
        throw new Error(
          `${where}: key "${m.key}" is malformed. Use "YYYYMMDDTHHMM_snake_name" in UTC, e.g. "20261014T0130_share_links".`
        );
      expected = m.key;
    } else if (typeof m.id === "number" && typeof m.name === "string") {
      if (!Number.isInteger(m.id) || m.id < 1 || m.id > LEGACY_MAX)
        throw new Error(
          `${where}: do not add numbered migrations; use a timestamp key (YYYYMMDDTHHMM_snake_name, UTC).`
        );
      expected = `${String(m.id).padStart(4, "0")}_${m.name}`;
    } else {
      throw new Error(`${where} needs a "key" (or a legacy "id" and "name").`);
    }
    if (file !== expected)
      throw new Error(
        `${where}: the file name must match its id. Rename it to ${expected}.ts.`
      );
    const k = migrationKey(m);
    const first = seen.get(k);
    if (first)
      throw new Error(
        `Duplicate migration ${k} in lib/db/migrations/${first}.ts and ${where}. Two tasks picked the same one: give yours a fresh timestamp key.`
      );
    seen.set(k, file);
    list.push(m);
  }
  const legacy = list
    .filter((m) => m.id !== undefined)
    .sort((a, b) => (a.id as number) - (b.id as number));
  const keyed = list
    .filter((m) => m.key !== undefined)
    .sort((a, b) => ((a.key as string) < (b.key as string) ? -1 : 1));
  return [...legacy, ...keyed];
}

// Legacy ids sort before every timestamp key.
function compareToUpTo(m: Migration, upTo: number | string): number {
  if (typeof upTo === "number") {
    return m.id === undefined ? 1 : m.id - upTo;
  }
  if (m.id !== undefined) return -1;
  return m.key < upTo ? -1 : m.key > upTo ? 1 : 0;
}

// All migrations in order - never modify existing ones, only add new
export const migrations: Migration[] = buildRegistry(migrationFiles);

/** How many of this build's migrations the database has; the update health check reads it. */
export function migrationStatus(db: Database.Database): {
  known: number;
  applied: number;
} {
  const rows = db.prepare(`SELECT id, key FROM _migrations`).all() as {
    id: number;
    key: string | null;
  }[];
  const have = new Set(rows.map((r) => r.key ?? String(r.id)));
  return {
    known: migrations.length,
    applied: migrations.filter((m) => have.has(migrationKey(m))).length,
  };
}

// `upTo`: stop after this legacy id or timestamp key, inclusive (tests that
// start from an older database).
export function runMigrations(
  db: Database.Database,
  upTo?: number | string
): void {
  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // Timestamp-keyed rows get an auto id and carry their key here; legacy rows
  // (key NULL) keep meaning "applied" by their integer id.
  const cols = db.prepare(`PRAGMA table_info(_migrations)`).all() as {
    name: string;
  }[];
  if (!cols.some((c) => c.name === "key")) {
    try {
      db.exec(`ALTER TABLE _migrations ADD COLUMN key TEXT`);
    } catch (error) {
      if (!String(error).includes("duplicate column")) throw error;
    }
  }
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_migrations_key ON _migrations(key)`
  );

  const applied = new Set(
    (
      db.prepare(`SELECT id, key FROM _migrations`).all() as {
        id: number;
        key: string | null;
      }[]
    ).map((r) => r.key ?? String(r.id))
  );

  // Use INSERT OR IGNORE to handle concurrent workers
  const insertLegacy = db.prepare(
    `INSERT OR IGNORE INTO _migrations (id, name) VALUES (?, ?)`
  );
  const insertKeyed = db.prepare(
    `INSERT OR IGNORE INTO _migrations (key, name) VALUES (?, ?)`
  );
  const record = (m: Migration) =>
    m.key === undefined
      ? insertLegacy.run(m.id, m.name)
      : insertKeyed.run(m.key, migrationName(m));

  for (const migration of migrations) {
    const key = migrationKey(migration);
    const name = migrationName(migration);
    if (
      applied.has(key) ||
      (upTo !== undefined && compareToUpTo(migration, upTo) > 0)
    )
      continue;

    try {
      migration.up(db);
      const result = record(migration);
      if (result.changes > 0) {
        console.log(`Migration ${key}: ${name} applied`);
      } else {
        console.log(`Migration ${key}: ${name} skipped (concurrent apply)`);
      }
    } catch (error) {
      // Some migrations may fail if columns already exist (from old system or concurrent worker)
      // Try to record as applied anyway to prevent re-running
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (
        errorMsg.includes("duplicate column") ||
        errorMsg.includes("already exists")
      ) {
        record(migration);
        console.log(`Migration ${key}: ${name} skipped (already applied)`);
      } else {
        console.error(`Migration ${key}: ${name} failed:`, error);
        throw error;
      }
    }
  }
}
