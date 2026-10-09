/**
 * A public demo is shared by strangers, so its database goes back to the
 * seed on a timer: a copy taken at startup is written back over every table
 * in one transaction, in this process, while it keeps serving.
 */

import fs from "fs";
import type Database from "better-sqlite3";
import { notifyStatusChanged } from "./status/hub";
import { resetDemoChat } from "./chat/demo";

export const RESEED_MS = 10 * 60 * 1000;

/** Copies the database as it is now to `file`, replacing what's there. */
export function snapshotDemo(db: Database.Database, file: string): void {
  fs.rmSync(file, { force: true });
  db.prepare("VACUUM INTO ?").run(file);
}

/** Puts every table back as it was in `file`, all at once. */
export function restoreDemo(db: Database.Database, file: string): void {
  db.prepare("ATTACH DATABASE ? AS seed").run(file);
  const fk = db.pragma("foreign_keys", { simple: true });
  db.pragma("foreign_keys = OFF");
  try {
    const quote = (n: string) => `"${n.replace(/"/g, '""')}"`;
    const tables = db
      .prepare(
        `SELECT name FROM seed.sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
      )
      .all() as { name: string }[];
    db.transaction(() => {
      for (const { name } of tables) {
        // Stored columns only: a generated one can't be written.
        const cols = (
          db.prepare(`SELECT * FROM pragma_table_xinfo(?)`).all(name) as {
            name: string;
            hidden: number;
          }[]
        )
          .filter((c) => c.hidden === 0)
          .map((c) => quote(c.name))
          .join(", ");
        const t = quote(name);
        db.exec(`DELETE FROM main.${t}`);
        db.exec(
          `INSERT INTO main.${t} (${cols}) SELECT ${cols} FROM seed.${t}`
        );
      }
    })();
  } finally {
    db.pragma(`foreign_keys = ${fk ? "ON" : "OFF"}`);
    db.exec("DETACH DATABASE seed");
  }
}

/** Snapshots now, then restores every `everyMs`; returns a stop function. */
export function startDemoReseed(
  db: Database.Database,
  file: string,
  everyMs = RESEED_MS
): () => void {
  snapshotDemo(db, file);
  const timer = setInterval(() => {
    try {
      restoreDemo(db, file);
      resetDemoChat();
      notifyStatusChanged();
    } catch (error) {
      console.error("Demo re-seed failed:", error);
    }
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
