import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { restoreDemo, snapshotDemo, startDemoReseed } from "./demo-reseed";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "demo-reseed-"));

function scratch() {
  const dir = tmp();
  const db = new Database(path.join(dir, "a.db"));
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE parents (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
    CREATE TABLE children (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parents(id), note TEXT);
    INSERT INTO parents (name) VALUES ('a'), ('b');
    INSERT INTO children VALUES (1, 1, 'seeded');
  `);
  return { db, seed: path.join(dir, "a.db.seed") };
}
const rows = (db: Database.Database) => ({
  parents: db.prepare("SELECT * FROM parents ORDER BY id").all(),
  children: db.prepare("SELECT * FROM children ORDER BY id").all(),
});

afterEach(() => vi.useRealTimers());

describe("demo re-seed", () => {
  it("puts every table back as it was, keeping foreign keys on", () => {
    const { db, seed } = scratch();
    snapshotDemo(db, seed);
    const before = rows(db);
    db.exec(`
      INSERT INTO parents (name) VALUES ('visitor');
      UPDATE children SET note = 'defaced';
      DELETE FROM children WHERE id = 1;
      DELETE FROM parents WHERE id = 2;
    `);
    restoreDemo(db, seed);
    expect(rows(db)).toEqual(before);
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(
      db
        .prepare(
          "SELECT count(*) AS n FROM pragma_database_list WHERE name = 'seed'"
        )
        .get()
    ).toEqual({ n: 0 });
  });

  it("keeps the snapshot owner-only, like the database", () => {
    const { db, seed } = scratch();
    snapshotDemo(db, seed);
    expect(fs.statSync(seed).mode & 0o777).toBe(0o600);
    expect(fs.statSync(seed).size).toBeGreaterThan(0);
  });

  it("restores on a timer, again and again, while the database stays open", () => {
    vi.useFakeTimers();
    const { db, seed } = scratch();
    const restored = vi.fn();
    const stop = startDemoReseed(db, seed, 1000, restored);
    const before = rows(db);
    for (let i = 0; i < 2; i++) {
      db.exec(`UPDATE children SET note = 'defaced ${i}'`);
      vi.advanceTimersByTime(1000);
      expect(rows(db)).toEqual(before);
    }
    expect(restored).toHaveBeenCalledTimes(2);
    stop();
    db.exec(`UPDATE children SET note = 'after stop'`);
    vi.advanceTimersByTime(5000);
    expect(rows(db).children).toEqual([
      { id: 1, parent_id: 1, note: "after stop" },
    ]);
  });

  it("works on the app's own schema", async () => {
    const { getDb } = await import("./db");
    const db = getDb();
    const seed = path.join(tmp(), "app.db.seed");
    const kept = randomUUID();
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory) VALUES (?, 'seeded', ?, '/tmp')`
    ).run(kept, `claude-${kept}`);
    snapshotDemo(db, seed);
    const added = randomUUID();
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory) VALUES (?, 'visitor', ?, '/tmp')`
    ).run(added, `claude-${added}`);
    db.prepare(`UPDATE sessions SET name = 'defaced' WHERE id = ?`).run(kept);
    restoreDemo(db, seed);
    const name = (id: string) =>
      (
        db.prepare(`SELECT name FROM sessions WHERE id = ?`).get(id) as
          | { name: string }
          | undefined
      )?.name;
    expect(name(kept)).toBe("seeded");
    expect(name(added)).toBeUndefined();
  });

  it("leaves access and settings alone: a device paired since stays paired", async () => {
    const { getDb } = await import("./db");
    const { mintDevice, getDevice } = await import("./security/devices");
    const db = getDb();
    const seed = path.join(tmp(), "app.db.seed");
    snapshotDemo(db, seed);
    const { device } = mintDevice("phone");
    restoreDemo(db, seed);
    expect(getDevice(device.id)?.name).toBe("phone");
  });
});
