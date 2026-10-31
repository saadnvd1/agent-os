import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSchema } from "./schema";
import { runMigrations } from "./migrations";

describe("chat_views migration", () => {
  it("applies on a database one migration behind, twice, and cleans up after a deleted chat", () => {
    const db = new Database(":memory:");
    createSchema(db);
    runMigrations(db, "20261031T1200");
    expect(
      db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'chat_views'`).get()
    ).toBeUndefined();
    runMigrations(db);
    runMigrations(db);
    const cols = (
      db.prepare(`PRAGMA table_info(chat_views)`).all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols).toEqual([
      "session_id",
      "item_id",
      "offset_px",
      "at_end",
      "viewed_at",
    ]);
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory) VALUES ('s', 'n', 't', '/tmp')`
    ).run();
    db.prepare(
      `INSERT INTO chat_views (session_id, viewed_at) VALUES ('s', 1), ('other', 2)`
    ).run();
    db.prepare(`DELETE FROM sessions WHERE id = 's'`).run();
    expect(db.prepare(`SELECT session_id FROM chat_views`).all()).toEqual([
      { session_id: "other" },
    ]);
  });
});
