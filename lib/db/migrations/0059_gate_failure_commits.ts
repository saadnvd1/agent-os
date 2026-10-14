import type { Migration } from "../migration-types";

export default {
  id: 59,
  name: "gate_failure_commits",
  up: (db) => {
    // Each head a gate failed on, once: a gate's failure counts once per
    // commit however many times that commit is judged (the armed watcher,
    // CI finishing, sign_off, done, land), and the second commit it fails
    // on goes to Saad. The key is what makes it once, across restarts and
    // concurrent evaluations.
    db.exec(`
        CREATE TABLE IF NOT EXISTS orchestrator_gate_failure_commits (
          session_id TEXT NOT NULL,
          gate TEXT NOT NULL,
          sha TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          reason TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (session_id, gate, sha)
        );
        INSERT OR IGNORE INTO orchestrator_gate_failure_commits (session_id, gate, sha, workspace_id, reason)
          SELECT session_id, gate, last_sha, workspace_id, last_reason
          FROM orchestrator_gate_failures WHERE last_sha IS NOT NULL;
        CREATE TRIGGER IF NOT EXISTS gate_failures_clear_commits
          AFTER DELETE ON orchestrator_gate_failures
        BEGIN
          DELETE FROM orchestrator_gate_failure_commits
            WHERE session_id = OLD.session_id AND gate = OLD.gate;
        END;
      `);
  },
} satisfies Migration;
