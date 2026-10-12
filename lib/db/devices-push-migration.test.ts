import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSchema } from "./schema";
import { runMigrations } from "./migrations";

const PUSH = [
  "push_token",
  "push_platform",
  "push_environment",
  "push_categories",
  "push_updated_at",
  "push_last_error",
];
const cols = (db: Database.Database) =>
  (db.prepare(`PRAGMA table_info(devices)`).all() as { name: string }[]).map(
    (c) => c.name
  );
const fresh = () => {
  const db = new Database(":memory:");
  createSchema(db);
  return db;
};

describe("devices push migration", () => {
  it("adds every push column on top of version 70, and again as a no-op", () => {
    const db = fresh();
    runMigrations(db, 70);
    expect(cols(db)).not.toContain("push_token");
    runMigrations(db);
    expect(cols(db)).toEqual(expect.arrayContaining(PUSH));
    runMigrations(db);
    expect(cols(db)).toEqual(expect.arrayContaining(PUSH));
  });

  it("finishes a run cut off with some columns already present", () => {
    const db = fresh();
    runMigrations(db, 70);
    db.exec(`ALTER TABLE devices ADD COLUMN push_token TEXT`);
    db.exec(`ALTER TABLE devices ADD COLUMN push_platform TEXT`);
    runMigrations(db);
    const have = cols(db);
    expect(have).toEqual(expect.arrayContaining(PUSH));
    expect(have.filter((c) => c === "push_token")).toHaveLength(1);
  });
});
