import type { Migration } from "../migration-types";

export default {
  key: "20261029T1200_artifact_versions",
  up: (db) => {
    // Each artifacts row is one version of a page; rows sharing page_id are
    // that page's history. Versions are only ever added, never rewritten.
    const cols = new Set(
      (
        db.prepare(`PRAGMA table_info(artifacts)`).all() as { name: string }[]
      ).map((c) => c.name)
    );
    const add = (name: string, type: string) => {
      if (!cols.has(name))
        db.exec(`ALTER TABLE artifacts ADD COLUMN ${name} ${type}`);
    };
    add("page_id", "TEXT");
    add("version", "INTEGER NOT NULL DEFAULT 1");
    // The agent's one line on what changed.
    add("note", "TEXT");
    add("bytes", "INTEGER");
    add("sha256", "TEXT");
    db.exec(`UPDATE artifacts SET page_id = id WHERE page_id IS NULL`);
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_page_version ON artifacts(page_id, version)`
    );
  },
} satisfies Migration;
