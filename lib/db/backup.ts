import type Database from "better-sqlite3";
import Sqlite from "better-sqlite3";
import { randomBytes } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { refuseRealStateUnderTest } from "../test-home-guard";

export const backupsDir = (): string =>
  refuseRealStateUnderTest(path.join(os.homedir(), ".agent-os", "backups"));

// A full copy of the database (VACUUM INTO) under ~/.agent-os/backups, taken
// before a destructive migration. Throws, and the migration must stop, unless
// the copy exists and holds every session. The message never says "already
// exists": the migration runner reads that as applied.
export function backupDatabase(
  db: Database.Database,
  label: string,
  dir: string = backupsDir()
): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const file = path.join(
    dir,
    `agent-os-${stamp}-${process.pid}-${randomBytes(3).toString("hex")}-${label}.db`
  );
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    db.prepare(`VACUUM INTO ?`).run(file);
    fs.chmodSync(file, 0o600);
    const copy = new Sqlite(file, { readonly: true });
    try {
      const count = (sql: Database.Database) =>
        (
          sql.prepare(`SELECT COUNT(*) AS n FROM sessions`).get() as {
            n: number;
          }
        ).n;
      if (count(copy) !== count(db)) throw new Error("session count differs");
    } finally {
      copy.close();
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Backup before ${label} failed (${file}): ${reason.replace(/already exists/gi, "is present")}. Nothing was changed.`
    );
  }
  return file;
}
