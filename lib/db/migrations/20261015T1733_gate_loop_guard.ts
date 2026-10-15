import type { Migration } from "../migration-types";

export default {
  key: "20261015T1733_gate_loop_guard",
  up: (db) => {
    // The loop guard (orchestrator/loop-guard.ts): how many commits in a row
    // a gate has failed on, the last failure's signature, whether it repeated
    // the one before, and the reason the task went to Saad. Additive.
    const columns = (table: string) =>
      new Set(
        (
          db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
        ).map((c) => c.name)
      );
    const failures = columns("orchestrator_gate_failures");
    if (!failures.has("streak")) {
      db.exec(
        `ALTER TABLE orchestrator_gate_failures ADD COLUMN streak INTEGER NOT NULL DEFAULT 0`
      );
      // A pass never reset the old count, so it's the most the streak can be.
      db.exec(`UPDATE orchestrator_gate_failures SET streak = count`);
    }
    if (!failures.has("last_signature"))
      db.exec(
        `ALTER TABLE orchestrator_gate_failures ADD COLUMN last_signature TEXT`
      );
    if (!failures.has("repeated"))
      db.exec(
        `ALTER TABLE orchestrator_gate_failures ADD COLUMN repeated INTEGER NOT NULL DEFAULT 0`
      );
    if (!failures.has("escalated_why"))
      db.exec(
        `ALTER TABLE orchestrator_gate_failures ADD COLUMN escalated_why TEXT`
      );
    if (!columns("orchestrator_gate_failure_commits").has("signature"))
      db.exec(
        `ALTER TABLE orchestrator_gate_failure_commits ADD COLUMN signature TEXT`
      );
  },
} satisfies Migration;
