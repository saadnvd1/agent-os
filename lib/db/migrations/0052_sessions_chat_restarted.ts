import type { Migration } from "../migration-types";

export default {
  id: 52,
  name: "sessions_chat_restarted",
  up: (db) => {
    // Set by a chat worker that retired cleanly after a deploy; the next
    // worker tells the agent so with its first message, then clears it.
    const columns = db.prepare(`PRAGMA table_info(sessions)`).all() as {
      name: string;
    }[];
    if (!columns.some((c) => c.name === "chat_restarted"))
      db.exec(
        `ALTER TABLE sessions ADD COLUMN chat_restarted INTEGER NOT NULL DEFAULT 0`
      );
  },
} satisfies Migration;
