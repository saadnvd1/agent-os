import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSchema } from "./schema";
import { runMigrations } from "./migrations";
import { readChangeVersions } from "./changes";

describe("chat_bookmarks migration", () => {
  it("applies on a database one migration behind, twice, and is watched", () => {
    const db = new Database(":memory:");
    createSchema(db);
    runMigrations(db, "20261014T1800");
    expect(
      db
        .prepare(`SELECT 1 FROM sqlite_master WHERE name = 'chat_bookmarks'`)
        .get()
    ).toBeUndefined();
    runMigrations(db);
    runMigrations(db);
    const cols = (
      db.prepare(`PRAGMA table_info(chat_bookmarks)`).all() as {
        name: string;
      }[]
    ).map((c) => c.name);
    expect(cols).toEqual([
      "id",
      "session_id",
      "item_id",
      "scope",
      "workspace_id",
      "kind",
      "text",
      "session_name",
      "note",
      "created_at",
    ]);
    const add = db.prepare(
      `INSERT INTO chat_bookmarks (id, session_id, item_id, scope, kind, text, session_name)
       VALUES (?, 's', 'i', ?, 'user', 't', 'n')`
    );
    add.run("a", "item");
    add.run("b", "turn");
    expect(() => add.run("c", "item")).toThrow(/UNIQUE/);
    expect(readChangeVersions(db).get("chat_bookmarks")).toBe(2);
  });
});
