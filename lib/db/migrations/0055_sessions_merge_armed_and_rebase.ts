import type { Migration } from "../migration-types";

export default {
  id: 55,
  name: "sessions_merge_armed_and_rebase",
  up: (db) => {
    // merge_armed_at: AgentOS merges the task's PR once every gate
    // passes (orchestrator/armed.ts); merge_armed_seen: the failure it
    // last reported. rebased_from/to: the heads an automatic rebase onto
    // the base moved the branch between, for the code-review gate.
    // rebase_asked_head: the head the task was last asked to rebase.
    const columns = db.prepare(`PRAGMA table_info(sessions)`).all() as {
      name: string;
    }[];
    for (const name of [
      "merge_armed_at",
      "merge_armed_seen",
      "rebased_from",
      "rebased_to",
      "rebase_asked_head",
    ])
      if (!columns.some((c) => c.name === name))
        db.exec(`ALTER TABLE sessions ADD COLUMN ${name} TEXT`);
  },
} satisfies Migration;
