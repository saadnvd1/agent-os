import type { Migration } from "../migration-types";

export default {
  id: 54,
  name: "sessions_chat_tools_digest",
  up: (db) => {
    // The tools a chat worker last gave the agent (an orchestrator's), so
    // the next one says they changed only when they did.
    const columns = db.prepare(`PRAGMA table_info(sessions)`).all() as {
      name: string;
    }[];
    if (!columns.some((c) => c.name === "chat_tools_digest"))
      db.exec(`ALTER TABLE sessions ADD COLUMN chat_tools_digest TEXT`);
  },
} satisfies Migration;
