import type { Migration } from "../migration-types";

export default {
  id: 79,
  name: "task_queue_agent",
  up: (db) => {
    // The agent CLI a queued task runs with; null is Claude Code.
    const has = (
      db.prepare(`PRAGMA table_info(task_queue)`).all() as { name: string }[]
    ).some((c) => c.name === "agent_type");
    if (!has) db.exec(`ALTER TABLE task_queue ADD COLUMN agent_type TEXT`);
  },
} satisfies Migration;
