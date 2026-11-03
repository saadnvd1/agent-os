import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { createSchema } from "./schema";
import { runMigrations } from "./migrations";
import migration from "./migrations/20261103T0200_remove_leads";

const BEFORE = "20261102T2359_lead_held_mail";
const LEAD_TABLES = [
  "lead_adoptions",
  "lead_areas",
  "lead_charters",
  "lead_direction",
  "lead_held_mail",
  "lead_memos",
  "lead_messages",
  "lead_pin_proposals",
  "workspace_leads",
];

const backupsDir = () => path.join(os.homedir(), ".agent-os", "backups");
const backups = () =>
  fs.existsSync(backupsDir()) ? fs.readdirSync(backupsDir()) : [];
const columns = (db: Database.Database, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (c) => c.name
  );
const tables = (db: Database.Database) =>
  (
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as {
      name: string;
    }[]
  ).map((t) => t.name);
const session = (db: Database.Database, id: string) =>
  db.prepare(`SELECT * FROM session_rows WHERE id = ?`).get(id) as Record<
    string,
    unknown
  >;

// A database as the leads work left it: Acme has its orchestrator shown as
// Tech lead, an adopted chat, a chief and a design lead the app made.
function withLeads() {
  const db = new Database(":memory:");
  createSchema(db);
  runMigrations(db, BEFORE);
  db.exec(`INSERT INTO workspaces (id, name) VALUES ('w1', 'Acme')`);
  db.exec(
    `INSERT INTO projects (id, name, working_directory) VALUES ('p1', 'P', '/tmp/p')`
  );
  const add = db.prepare(
    `INSERT INTO sessions (id, name, role, lead_kind, workspace_id, project_id, pinned, orch_token)
     VALUES (?, ?, ?, ?, ?, ?, 1, 'tok')`
  );
  add.run("orch", "Acme Tech lead", "orchestrator", "tech", "w1", null);
  add.run("adopted", "Acme Marketing lead", "lead", "marketing", "w1", "p1");
  add.run("chief", "Acme Chief of staff", "chief", null, "w1", null);
  add.run("design", "Acme Design lead", "lead", "design", "w1", null);
  db.exec(`
    INSERT INTO session_names (session_id, name, renamed_at) VALUES
      ('adopted', 'Marketing lead', '2026-11-02 16:00:00'),
      ('orch', 'Acme orchestrator', '2026-11-02 22:00:00');
    INSERT INTO lead_adoptions (session_id, workspace_id, lead_kind, adopted_at)
      VALUES ('adopted', 'w1', 'marketing', '2026-11-02 22:48:03');
    INSERT INTO workspace_leads (workspace_id) VALUES ('w1');
    INSERT INTO lead_charters (workspace_id, lead_kind, title) VALUES ('w1', 'tech', 'Tech');
    INSERT INTO lead_memos (workspace_id, lead_kind, text) VALUES ('w1', 'marketing', 'm');
    INSERT INTO orchestrator_notes (workspace_id, text, lead_kind)
      VALUES ('w1', 'tech note', 'tech'), ('w1', 'chief note', 'chief');
    INSERT INTO orchestrator_asks (workspace_id, subject, kind, title, lead_kind)
      VALUES ('w1', 'a', 'k', 'tech ask', 'tech'), ('w1', 'b', 'k', 'chief ask', 'chief');
    INSERT INTO needs_you_dismissed (workspace_id, key)
      VALUES ('w1', 'approval:orch'), ('w1', 'approval:chief');
    INSERT INTO schedules (id, workspace_id, name, cron, prompt, kind, armed_at, target_session_id)
      VALUES ('sw', 'w1', 'Chief of staff daily sweep', '0 8 * * *', 'x', 'message', 0, 'chief');
    INSERT INTO settings (key, value) VALUES ('experiments.leads', '1');
  `);
  return db;
}

beforeEach(() => fs.rmSync(backupsDir(), { recursive: true, force: true }));

describe("remove leads migration", () => {
  it("drops the lead tables and columns and puts every session back", () => {
    const db = withLeads();
    migration.up(db);

    for (const t of LEAD_TABLES) expect(tables(db)).not.toContain(t);
    for (const c of ["lead_kind", "lead_since", "started_by_lead"]) {
      expect(columns(db, "sessions")).not.toContain(c);
      expect(columns(db, "session_rows")).not.toContain(c);
    }
    expect(columns(db, "orchestrator_notes")).not.toContain("lead_kind");
    expect(columns(db, "orchestrator_asks")).not.toContain("lead_kind");

    // The adopted chat is a plain session again, with its original name.
    expect(session(db, "adopted")).toMatchObject({
      name: "Marketing lead",
      role: null,
      workspace_id: null,
      project_id: "p1",
    });

    // Sessions made as leads are archived with their rows kept.
    for (const id of ["chief", "design"])
      expect(session(db, id)).toMatchObject({
        role: null,
        workspace_id: null,
        pinned: 0,
      });
    expect(session(db, "chief").archived_at).toBeTruthy();
    expect(session(db, "design").archived_at).toBeTruthy();
    expect(
      db.prepare(`SELECT enabled, archived_at FROM schedules`).get()
    ).toMatchObject({ enabled: 0 });

    expect(session(db, "orch")).toMatchObject({
      name: "Acme orchestrator",
      role: "orchestrator",
      workspace_id: "w1",
    });
    expect(db.prepare(`SELECT text FROM orchestrator_notes`).all()).toEqual([
      { text: "tech note" },
    ]);
    expect(db.prepare(`SELECT title FROM orchestrator_asks`).all()).toEqual([
      { title: "tech ask" },
    ]);
    expect(db.prepare(`SELECT key FROM needs_you_dismissed`).all()).toEqual([
      { key: "approval:w1" },
    ]);
    expect(
      db.prepare(`SELECT 1 FROM settings WHERE key = 'experiments.leads'`).get()
    ).toBeUndefined();
    expect(backups()).toHaveLength(1);
  });

  it("is safe to run again", () => {
    const db = withLeads();
    migration.up(db);
    const before = db.prepare(`SELECT * FROM session_rows ORDER BY id`).all();
    migration.up(db);
    expect(db.prepare(`SELECT * FROM session_rows ORDER BY id`).all()).toEqual(
      before
    );
    expect(backups()).toHaveLength(1);
  });

  it("changes nothing on a database that never had leads", () => {
    const db = new Database(":memory:");
    createSchema(db);
    runMigrations(db, "20261102T0100_forks");
    db.exec(`INSERT INTO sessions (id, name) VALUES ('s', 'plain')`);
    const schema = () =>
      db.prepare(`SELECT name, sql FROM sqlite_master ORDER BY name`).all();
    const before = schema();
    migration.up(db);
    expect(schema()).toEqual(before);
    expect(backups()).toEqual([]);
  });
});
