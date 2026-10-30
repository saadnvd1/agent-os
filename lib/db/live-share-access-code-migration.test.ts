import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSchema } from "./schema";
import { runMigrations } from "./migrations";
import migration from "./migrations/20261031T1200_live_share_access_code";

describe("live share access code migration", () => {
  it("reads an old row as no code, and is safe to run twice", () => {
    const db = new Database(":memory:");
    createSchema(db);
    runMigrations(db);
    db.prepare(
      `INSERT INTO live_shares (id, session_id, title, url, created_at) VALUES ('a', 's', 't', 'https://x', 'now')`
    ).run();
    migration.up(db);
    migration.up(db);
    expect(db.prepare(`SELECT access_code FROM live_shares`).get()).toEqual({
      access_code: null,
    });
  });
});
