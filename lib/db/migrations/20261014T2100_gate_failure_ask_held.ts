import type { Migration } from "../migration-types";

export default {
  key: "20261014T2100_gate_failure_ask_held",
  up: (db) => {
    // When a failed-twice escalation started holding its ask until the
    // agent is idle and CI has settled; null is not held. Additive.
    const has = (
      db.prepare(`PRAGMA table_info(orchestrator_gate_failures)`).all() as {
        name: string;
      }[]
    ).some((c) => c.name === "ask_held_at");
    if (!has)
      db.exec(
        `ALTER TABLE orchestrator_gate_failures ADD COLUMN ask_held_at TEXT`
      );
  },
} satisfies Migration;
