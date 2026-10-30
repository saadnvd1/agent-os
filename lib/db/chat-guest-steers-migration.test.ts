import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSchema } from "./schema";
import { runMigrations } from "./migrations";
import migration from "./migrations/20261030T1300_chat_guest_steers";

describe("chat guest steers migration", () => {
  it("keeps one steer per session, and is safe to run twice", () => {
    const db = new Database(":memory:");
    createSchema(db);
    runMigrations(db);
    migration.up(db);
    const put = db.prepare(
      `INSERT OR REPLACE INTO chat_guest_steers (session_id, share_id, wheel, guest_id, name, started_at) VALUES ('s', 'live1', ?, 'g1', 'Ahmed', 1)`
    );
    put.run("w1");
    put.run("w2");
    expect(
      db.prepare(`SELECT wheel, tool_calls FROM chat_guest_steers`).all()
    ).toEqual([{ wheel: "w2", tool_calls: 0 }]);
  });
});
