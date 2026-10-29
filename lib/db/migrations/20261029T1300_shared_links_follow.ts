import type { Migration } from "../migration-types";

export default {
  key: "20261029T1300_shared_links_follow",
  up: (db) => {
    // follow_latest: the link is re-uploaded whenever its page gets a new
    // version. version: the page version the link shows now (pinned or not).
    const cols = new Set(
      (
        db.prepare(`PRAGMA table_info(shared_links)`).all() as {
          name: string;
        }[]
      ).map((c) => c.name)
    );
    if (!cols.has("follow_latest"))
      db.exec(
        `ALTER TABLE shared_links ADD COLUMN follow_latest INTEGER NOT NULL DEFAULT 0`
      );
    if (!cols.has("version"))
      db.exec(`ALTER TABLE shared_links ADD COLUMN version INTEGER`);
    // Links made before this show the version their artifact row is.
    db.exec(
      `UPDATE shared_links SET version = (
         SELECT a.version FROM artifacts a WHERE a.id = shared_links.artifact_id
       ) WHERE version IS NULL AND artifact_id IS NOT NULL`
    );
  },
} satisfies Migration;
