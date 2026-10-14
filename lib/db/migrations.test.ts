import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSchema } from "./schema";
import { migrationKey, migrations, runMigrations } from "./migrations";

const FIXTURE = join(__dirname, "migrations-legacy-checksums.json");
const KEY_RE = /^\d{8}T\d{4}_[a-z0-9]+(_[a-z0-9]+)*$/;

const checksum = (fn: unknown) =>
  createHash("sha256")
    .update(String(fn).replace(/\s+/g, ""))
    .digest("hex")
    .slice(0, 16);

const legacy = migrations.filter((m) => m.id !== undefined);
const keyed = migrations.filter((m) => m.key !== undefined);

describe("migration registry guard", () => {
  it("has no duplicate ids or keys", () => {
    const seen = new Set<string>();
    for (const m of migrations) {
      const k = migrationKey(m);
      expect(
        seen.has(k),
        `Duplicate migration ${k}. Two tasks picked the same one: give yours a fresh timestamp key (YYYYMMDDTHHMM_snake_name, UTC), never a number.`
      ).toBe(false);
      seen.add(k);
    }
  });

  it("uses well-formed timestamp keys for every new migration", () => {
    for (const m of keyed) {
      expect(
        KEY_RE.test(m.key as string),
        `Migration key "${m.key}" is malformed. Use "YYYYMMDDTHHMM_snake_name" in UTC, e.g. "20261014T0130_share_links".`
      ).toBe(true);
    }
  });

  it("adds no new integer ids and keeps timestamp keys after the legacy block", () => {
    const ids = legacy.map((m) => m.id as number);
    expect(
      Math.max(...ids),
      "Do not add numbered migrations: use a timestamp key (YYYYMMDDTHHMM_snake_name, UTC)."
    ).toBe(89);
    expect(ids).toEqual(Array.from({ length: 89 }, (_, i) => i + 1));
    const firstKeyed = migrations.findIndex((m) => m.key !== undefined);
    if (firstKeyed >= 0) {
      expect(
        migrations.slice(firstKeyed).every((m) => m.key !== undefined),
        "Keyed migrations must come after all legacy ids in the array."
      ).toBe(true);
    }
  });

  it("lists timestamp keys in lexical order", () => {
    const keys = keyed.map((m) => m.key as string);
    expect(
      keys,
      "Migrations run in key order, so keep the array sorted by key: move yours to its sorted place."
    ).toEqual([...keys].sort());
  });

  it("never changes the body of a legacy migration", () => {
    const current = Object.fromEntries(
      legacy.map((m) => [m.id, checksum(m.up)])
    );
    if (!existsSync(FIXTURE) || process.env.UPDATE_MIGRATION_CHECKSUMS) {
      writeFileSync(FIXTURE, JSON.stringify(current, null, 2) + "\n");
    }
    const expected = JSON.parse(readFileSync(FIXTURE, "utf8"));
    const changed = Object.keys(expected).filter(
      (id) => expected[id] !== current[id]
    );
    expect(
      changed,
      `Legacy migration(s) ${changed.join(", ")} changed after being applied. Revert the edit and add a NEW migration with a timestamp key instead; databases that already ran the old body will never re-run it.`
    ).toEqual([]);
  });
});

describe("runMigrations with keys", () => {
  it("upgrades a database with 1..89 applied without rerunning any legacy migration", () => {
    const db = new Database(":memory:");
    createSchema(db);
    runMigrations(db, 89);
    // Simulate a pre-upgrade database: no key column, 89 integer rows.
    const rows = db.prepare(`SELECT id, name FROM _migrations`).all() as {
      id: number;
      name: string;
    }[];
    expect(rows).toHaveLength(89);
    db.exec(`
      DROP INDEX IF EXISTS idx_migrations_key;
      ALTER TABLE _migrations DROP COLUMN key;
    `);

    const calls: number[] = [];
    const originals = legacy.map((m) => m.up);
    legacy.forEach((m) => {
      m.up = () => {
        calls.push(m.id as number);
      };
    });
    try {
      runMigrations(db);
    } finally {
      legacy.forEach((m, i) => (m.up = originals[i]));
    }
    expect(calls).toEqual([]);
    const after = db.prepare(`SELECT id FROM _migrations WHERE id <= 89`).all();
    expect(after).toHaveLength(89);
  });

  it("applies keyed migrations once, after legacy, and honours upTo keys", () => {
    const db = new Database(":memory:");
    createSchema(db);
    runMigrations(db, 89);
    const order: string[] = [];
    const fakes = [
      { key: "29990101T0000_a_test", up: () => void order.push("a") },
      { key: "29990102T0000_b_test", up: () => void order.push("b") },
    ];
    migrations.push(...fakes);
    try {
      runMigrations(db, "29990101T0000_a_test");
      expect(order).toEqual(["a"]);
      runMigrations(db);
      runMigrations(db);
      expect(order).toEqual(["a", "b"]);
      const keys = db
        .prepare(
          `SELECT key FROM _migrations WHERE key LIKE '2999%' ORDER BY id`
        )
        .all();
      expect(keys).toEqual([
        { key: "29990101T0000_a_test" },
        { key: "29990102T0000_b_test" },
      ]);
    } finally {
      migrations.splice(migrations.length - fakes.length, fakes.length);
    }
  });

  it("does not apply keyed migrations when upTo is a legacy id", () => {
    const db = new Database(":memory:");
    createSchema(db);
    let ran = false;
    migrations.push({
      key: "29990103T0000_c_test",
      up: () => void (ran = true),
    });
    try {
      runMigrations(db, 89);
      expect(ran).toBe(false);
    } finally {
      migrations.pop();
    }
  });
});
