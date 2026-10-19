import type { Migration } from "../migration-types";

export default {
  key: "20261019T1200_chat_queue_files",
  up: (db) => {
    // Files attached to a queued message, as a JSON list of references to
    // the session's attachments folder (never the bytes).
    const cols = db.prepare(`PRAGMA table_info(chat_queue)`).all() as {
      name: string;
    }[];
    if (!cols.some((c) => c.name === "files"))
      db.exec(`ALTER TABLE chat_queue ADD COLUMN files TEXT`);
  },
} satisfies Migration;
