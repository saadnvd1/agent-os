import type { Migration } from "../migration-types";

export default {
  // 50 is taken by queued tasks, landing separately.
  id: 51,
  name: "chat_queue_sent_by",
  up: (db) => {
    // Who sent a queued message the reader didn't type (lib/chat/events
    // SentBy, as JSON), so it still shows as theirs once it's sent.
    const columns = db.prepare(`PRAGMA table_info(chat_queue)`).all() as {
      name: string;
    }[];
    if (!columns.some((c) => c.name === "sent_by"))
      db.exec(`ALTER TABLE chat_queue ADD COLUMN sent_by TEXT`);
  },
} satisfies Migration;
