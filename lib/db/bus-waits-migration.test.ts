import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSchema } from "./schema";
import { runMigrations } from "./migrations";

describe("bus waits migration", () => {
  it("adds the waits table and reply_to, and is safe to run twice", () => {
    const db = new Database(":memory:");
    createSchema(db);
    runMigrations(db);
    runMigrations(db);
    db.prepare(
      `INSERT INTO bus_waits (waiter_id, target_id, kind, deadline, created_at)
       VALUES ('a', 'b', 'reply', 1, 0)`
    ).run();
    expect(
      db.prepare(`SELECT closed_at, nudged_at FROM bus_waits`).get()
    ).toEqual({ closed_at: null, nudged_at: null });
    const cols = db.prepare(`PRAGMA table_info(bus_messages)`).all() as {
      name: string;
    }[];
    expect(cols.map((c) => c.name)).toContain("reply_to");
  });
});
