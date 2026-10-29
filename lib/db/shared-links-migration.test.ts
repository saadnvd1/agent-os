import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSchema } from "./schema";
import { runMigrations } from "./migrations";
import follow from "./migrations/20261029T1300_shared_links_follow";

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
      "follow_latest",
      "version",
    ]);
  });

  it("adds follow_latest (off) and the shown version, and re-runs cleanly", () => {
    const db = new Database(":memory:");
    createSchema(db);
    runMigrations(db);
    db.prepare(
      `INSERT INTO artifacts (id, session_id, title, path, page_id, version)
       VALUES ('a2', 's', 't', '/p', 'a1', 2)`
    ).run();
    // A link as the build before this wrote it.
    db.exec(`DROP TABLE shared_links`);
    db.exec(
      `CREATE TABLE shared_links (id TEXT PRIMARY KEY, url TEXT NOT NULL, kind TEXT NOT NULL,
        title TEXT NOT NULL, session_id TEXT, artifact_id TEXT, expires_at TEXT,
        created_at TEXT NOT NULL, revoked_at TEXT)`
    );
    db.prepare(
      `INSERT INTO shared_links VALUES ('l1','u','artifact','t',NULL,'a2',NULL,'2026-01-01',NULL),
        ('l2','u','chat','t','s',NULL,NULL,'2026-01-01',NULL)`
    ).run();
    follow.up(db);
    follow.up(db);
    expect(
      db
        .prepare(
          `SELECT id, follow_latest, version FROM shared_links ORDER BY id`
        )
        .all()
    ).toEqual([
      { id: "l1", follow_latest: 0, version: 2 },
      { id: "l2", follow_latest: 0, version: null },
    ]);
  });
});
