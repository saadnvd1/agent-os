import type { Migration } from "../migration-types";

export default {
  id: 29,
  name: "add_orchestrator_asks_and_pause",
  up: (db) => {
    // Items the orchestrator parks for Saad. One open ask per subject (a
    // task, the brakes, a title it raised), so a repeat escalation updates
    // it instead of adding another. An approval of a gate or brake ask is
    // spent once (used_at), on the commit it was asked about (sha).
    db.exec(`
        CREATE TABLE IF NOT EXISTS orchestrator_asks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id TEXT NOT NULL,
          subject TEXT NOT NULL,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          detail TEXT NOT NULL DEFAULT '',
          link TEXT,
          sha TEXT,
          status TEXT NOT NULL DEFAULT 'open',
          answer TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          resolved_at TEXT,
          used_at TEXT,
          brake_key TEXT
        )
      `);
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_orchestrator_asks_open
         ON orchestrator_asks(workspace_id, subject) WHERE status = 'open'`
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_orchestrator_asks_workspace
         ON orchestrator_asks(workspace_id, status)`
    );
    // While set, the orchestrator acts on nothing: events queue and its
    // acting tools refuse.
    db.exec(`ALTER TABLE workspaces ADD COLUMN orch_paused_at TEXT`);
    // Proof a person approves: a paired device may answer asks only once
    // Saad lets it, and approvals that matter need a passkey assertion
    // (user verification) on a challenge bound to the one item.
    db.exec(
      `ALTER TABLE devices ADD COLUMN can_approve INTEGER NOT NULL DEFAULT 0`
    );
    db.exec(`
        CREATE TABLE IF NOT EXISTS passkeys (
          id TEXT PRIMARY KEY,
          public_key BLOB NOT NULL,
          counter INTEGER NOT NULL DEFAULT 0,
          transports TEXT,
          rp_id TEXT NOT NULL,
          name TEXT NOT NULL,
          registered_via TEXT,
          registered_from TEXT,
          user_agent TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_used_at TEXT,
          revoked_at TEXT
        )
      `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS presence_challenges (
          challenge TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          purpose TEXT NOT NULL,
          binding TEXT NOT NULL,
          rp_id TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          used_at INTEGER
        )
      `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS passkey_enrollments (
          code_hash TEXT PRIMARY KEY,
          expires_at INTEGER NOT NULL,
          used_at INTEGER
        )
      `);
  },
} satisfies Migration;
