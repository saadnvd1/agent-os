import type { Migration } from "../migration-types";

export default {
  id: 49,
  name: "peer_mirror",
  up: (db) => {
    // A row that only shows a linked machine's own session: actions on
    // it go to that machine. Rows this machine started there over ssh
    // are its own, and stay 0.
    db.exec(
      `ALTER TABLE sessions ADD COLUMN peer_mirror INTEGER NOT NULL DEFAULT 0`
    );
  },
} satisfies Migration;
