import { AsyncLocalStorage } from "node:async_hooks";
import type Database from "better-sqlite3";

/**
 * Tests only: runs a function against another database, so one process can
 * stand in for two machines. `getDb()` (and so `db`) follows the scope; in
 * production nothing is ever scoped and it returns the one database.
 */
export const machineDb = new AsyncLocalStorage<Database.Database>();

export const runOnMachine = <T>(database: Database.Database, fn: () => T): T =>
  machineDb.run(database, fn);
