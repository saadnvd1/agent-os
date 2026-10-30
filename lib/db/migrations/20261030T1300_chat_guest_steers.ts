import type { Migration } from "../migration-types";

export default {
  key: "20261030T1300_chat_guest_steers",
  up: (db) => {
    // A live guest's steer on a chat (lib/chat/worker/guest-gate): kept
    // here so a worker that restarts mid-Drive still gates its turns.
    db.exec(
      `CREATE TABLE IF NOT EXISTS chat_guest_steers (
         session_id TEXT PRIMARY KEY,
         share_id TEXT NOT NULL,
         wheel TEXT NOT NULL,
         guest_id TEXT NOT NULL,
         name TEXT NOT NULL,
         tool_calls INTEGER NOT NULL DEFAULT 0,
         started_at INTEGER NOT NULL
       )`
    );
  },
} satisfies Migration;
