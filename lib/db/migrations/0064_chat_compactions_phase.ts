import type { Migration } from "../migration-types";

export default {
  id: 64,
  name: "chat_compactions_phase",
  up: (db) => {
    // Whether the agent compacted itself mid-turn or AgentOS (or a typed
    // /compact) did between turns; null on rows from before.
    const columns = db.prepare(`PRAGMA table_info(chat_compactions)`).all() as {
      name: string;
    }[];
    if (!columns.some((c) => c.name === "phase"))
      db.exec(`ALTER TABLE chat_compactions ADD COLUMN phase TEXT`);
  },
} satisfies Migration;
