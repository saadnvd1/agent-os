import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { createSchema } from "./schema";
import { runMigrations } from "./migrations";

describe("usage ledger migration", () => {
  it("adds the ledger tables on top of an older database, and runs again as a no-op", () => {
    const file = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "aos-mig-")),
      "t.db"
    );
    const db = new Database(file);
    createSchema(db);
    runMigrations(db, 67);
    expect(
      db
        .prepare(`SELECT name FROM sqlite_master WHERE name = 'usage_calls'`)
        .get()
    ).toBeUndefined();
    runMigrations(db);
    runMigrations(db);
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'usage_%' OR name = 'rate_limit_readings'`
      )
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "usage_calls",
        "usage_rollups",
        "usage_baseline",
        "usage_alerts",
        "usage_import_offsets",
        "rate_limit_readings",
      ])
    );
    db.close();
  });
});
