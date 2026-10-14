import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSchema } from "./schema";
import { runMigrations } from "./migrations";

describe("shared_links migration", () => {
  it("applies on a database that is one migration behind, and twice", () => {
    const db = new Database(":memory:");
    createSchema(db);
    runMigrations(db, 85);
    expect(
      db
        .prepare(`SELECT 1 FROM sqlite_master WHERE name = 'shared_links'`)
        .get()
    ).toBeUndefined();
    runMigrations(db);
    runMigrations(db);
    const cols = (
      db.prepare(`PRAGMA table_info(shared_links)`).all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols).toEqual([
      "id",
      "url",
      "kind",
      "title",
      "session_id",
      "artifact_id",
      "expires_at",
      "created_at",
      "revoked_at",
    ]);
  });
});
