import type { Migration } from "../migration-types";

export default {
  id: 21,
  name: "add_chat_access",
  up: (db) => {
    // What a chat agent may do without asking; full is the old behavior.
    db.exec(
      `ALTER TABLE sessions ADD COLUMN chat_access TEXT NOT NULL DEFAULT 'full'`
    );
    // After an undo, where the next start resumes the conversation from.
    db.exec(`ALTER TABLE sessions ADD COLUMN chat_resume_at TEXT`);
  },
} satisfies Migration;
