import type { Migration } from "../migration-types";
import { createSessionRowsView } from "../session-parts/view";

const columnsOf = (db: Parameters<Migration["up"]>[0], table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (c) => c.name
  );

export default {
  key: "20261102T2345_lead_mail",
  up: (db) => {
    // The direction pins a lead's mail relies on, as the server checked them
    // (a JSON array of pin ids).
    if (!columnsOf(db, "lead_messages").includes("pins"))
      db.exec(`ALTER TABLE lead_messages ADD COLUMN pins TEXT`);
    // The lead (or 'chief') whose call started a session, next to
    // started_by, so who asked survives the lead's session changing.
    if (!columnsOf(db, "sessions").includes("started_by_lead"))
      db.exec(`ALTER TABLE sessions ADD COLUMN started_by_lead TEXT`);
    createSessionRowsView(db);
  },
} satisfies Migration;
