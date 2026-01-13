import Database from "better-sqlite3";
import path from "path";
import { createSchema } from "./schema";
import { runMigrations } from "./migrations";

// Re-export types and queries
export * from "./types";
export { queries } from "./queries";

const DB_PATH =
  process.env.DB_PATH || path.join(process.cwd(), "agent-os.db");

// Initialize database with schema
export function initDb(): Database.Database {
  const db = new Database(DB_PATH);

  // Enable WAL mode for better concurrency
  db.pragma("journal_mode = WAL");

  // Create tables and indexes
  createSchema(db);

  // Run migrations
  runMigrations(db);

  return db;
}

// Singleton database instance
let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = initDb();
  }
  return _db;
}

// Direct export for convenience
export const db = getDb();
