import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSchema } from "./schema";
import { runMigrations } from "./migrations";

describe("push_outbox migration", () => {
  it("creates the table on top of version 71, and again as a no-op", () => {
    const db = new Database(":memory:");
    createSchema(db);
    runMigrations(db, 71);
    expect(
      db
        .prepare(`SELECT name FROM sqlite_master WHERE name = 'push_outbox'`)
        .get()
    ).toBeUndefined();
    runMigrations(db);
    runMigrations(db);
    const cols = (
      db.prepare(`PRAGMA table_info(push_outbox)`).all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols).toEqual(
      expect.arrayContaining([
        "event_key",
        "device_id",
        "state",
        "attempts",
        "collapse_id",
        "fallback_text",
      ])
    );
  });

  it("holds one row per event and device", () => {
    const db = new Database(":memory:");
    createSchema(db);
    runMigrations(db);
    const ins = db.prepare(
      `INSERT OR IGNORE INTO push_outbox (event_key, device_id, category, level, payload, state, next_attempt_at, created_at)
       VALUES (?, ?, 'asks', 'active', '{}', 'pending', 0, 0)`
    );
    expect(ins.run("k", "d1").changes).toBe(1);
    expect(ins.run("k", "d1").changes).toBe(0);
    expect(ins.run("k", "d2").changes).toBe(1);
  });
});
