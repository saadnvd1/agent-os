import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSchema } from "./schema";
import {
  buildRegistry,
  migrationKey,
  migrations,
  runMigrations,
  type Migration,
} from "./migrations";
import { migrationFiles } from "./migrations.generated";

const FIXTURE = join(__dirname, "migrations-legacy-checksums.json");
const SNAPSHOT = join(__dirname, "migrations-split-snapshot.json");
const KEY_RE = /^\d{8}T\d{4}_[a-z0-9]+(_[a-z0-9]+)*$/;

const checksum = (fn: unknown) =>
  createHash("sha256")
    .update(
      String(fn)
        .replace(/__vite_ssr_import_\d+__/g, "__vite_ssr_import__")
        .replace(/\s+/g, "")
    )
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

// What the single-file list produced, captured before it was split into
// lib/db/migrations/. The set of migrations up to lastKey is frozen, so this
// fixture never changes when a new migration is added.
const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as {
  lastKey: string;
  applied: { id: number; key: string | null; name: string }[];
  schema: unknown[];
};

const schemaOf = (db: Database.Database) =>
  db
    .prepare(
      `SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`
    )
    .all();

describe("one file per migration", () => {
  it("does not re-run anything on a database migrated by the old list", () => {
    const db = new Database(":memory:");
    createSchema(db);
    db.exec(`CREATE TABLE _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      key TEXT
    )`);
    for (const r of snapshot.applied) {
      if (r.key === null)
        db.prepare(`INSERT INTO _migrations (id, name) VALUES (?, ?)`).run(
          r.id,
          r.name
        );
      else
        db.prepare(`INSERT INTO _migrations (key, name) VALUES (?, ?)`).run(
          r.key,
          r.name
        );
    }
    const calls: string[] = [];
    const originals = migrations.map((m) => m.up);
    migrations.forEach((m) => {
      m.up = () => void calls.push(migrationKey(m));
    });
    try {
      runMigrations(db, snapshot.lastKey);
    } finally {
      migrations.forEach((m, i) => (m.up = originals[i]));
    }
    expect(calls).toEqual([]);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM _migrations`).get()).toEqual({
      n: snapshot.applied.length,
    });
  });

  it("covers exactly the migrations the old list had, with the same names", () => {
    const upToLast = migrations.filter(
      (m) => m.id !== undefined || (m.key as string) <= snapshot.lastKey
    );
    expect(
      upToLast.map((m) => [
        m.id ?? null,
        m.key ?? null,
        m.name ?? (m.key as string).replace(/^\d{8}T\d{4}_/, ""),
      ])
    ).toEqual(
      snapshot.applied.map((r) => [r.key === null ? r.id : null, r.key, r.name])
    );
  });

  it("builds the same schema on a fresh database", () => {
    const db = new Database(":memory:");
    createSchema(db);
    runMigrations(db, snapshot.lastKey);
    expect(schemaOf(db)).toEqual(snapshot.schema);
    const rows = db
      .prepare(`SELECT id, key, name FROM _migrations ORDER BY id`)
      .all();
    expect(rows).toEqual(snapshot.applied);
  });

  it("runs by id: legacy numbers first, then timestamp keys in order", () => {
    const keys = migrations.map(migrationKey);
    const legacyKeys = legacy.map((m) => String(m.id));
    const keyedKeys = keyed.map((m) => m.key as string);
    expect(keys).toEqual([...legacyKeys, ...[...keyedKeys].sort()]);
    const shuffled = Object.fromEntries(
      Object.entries(migrationFiles).reverse()
    );
    expect(buildRegistry(shuffled).map(migrationKey)).toEqual(keys);
  });

  it("has one file per migration, named for its id, in the generated index", () => {
    const files = readdirSync(join(__dirname, "migrations"))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => f.slice(0, -3))
      .sort();
    expect(Object.keys(migrationFiles).sort()).toEqual(files);
    expect(files).toHaveLength(migrations.length);
    expect(() =>
      execFileSync(
        process.execPath,
        [join(__dirname, "../../scripts/gen-migrations-index.mjs"), "--check"],
        { stdio: "pipe" }
      )
    ).not.toThrow();
  });
});

describe("buildRegistry fails loudly", () => {
  const k = (key: string): Migration => ({ key, up: () => {} });
  const l = (id: number, name: string): Migration => ({
    id,
    name,
    up: () => {},
  });

  it("on a duplicate id, naming both files", () => {
    expect(() =>
      buildRegistry({ "0001_a": l(1, "a"), "0001_b": l(1, "b") })
    ).toThrow(/Duplicate migration 1 in .*0001_a\.ts and .*0001_b\.ts/);
  });

  it("on a duplicate key (a copied file keeps the old key)", () => {
    const m = k("29990101T0000_a_test");
    expect(() =>
      buildRegistry({ "29990101T0000_a_test": m, "29990101T0000_a_copy": m })
    ).toThrow(/29990101T0000_a_copy\.ts.*Rename it to 29990101T0000_a_test/);
  });

  it("when the file name does not match the key or id", () => {
    expect(() =>
      buildRegistry({ "29990101T0000_a_test": k("29990101T0000_b_test") })
    ).toThrow(/Rename it to 29990101T0000_b_test.ts/);
    expect(() => buildRegistry({ "0001_wrong": l(1, "right") })).toThrow(
      /Rename it to 0001_right.ts/
    );
    expect(() => buildRegistry({ "0002_x": l(1, "x") })).toThrow(
      /Rename it to 0001_x.ts/
    );
  });

  it("on a malformed key, a new numbered migration, or a missing up", () => {
    expect(() => buildRegistry({ bad_key: k("bad_key") })).toThrow(/malformed/);
    expect(() => buildRegistry({ "0090_x": l(90, "x") })).toThrow(
      /numbered migrations/
    );
    expect(() =>
      buildRegistry({ "29990101T0000_a_test": {} as unknown as Migration })
    ).toThrow(/default-export/);
  });
});
