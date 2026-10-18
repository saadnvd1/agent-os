/**
 * What the disk clean-up would remove, without removing anything: runs a dry
 * sweep against a copy of the live database and writes the list to
 * ~/.agent-os/audits/disk-cleanup/<date>.md.
 *
 *   npm run disk:dry-run -- --db <path to the live agent-os.db>
 *
 * The live database is opened read-only for the copy and never written; the
 * copy is deleted afterwards. Nothing on disk or in Postgres is touched.
 */

import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";

const arg = process.argv.indexOf("--db");
const live: string = (arg > 0 && process.argv[arg + 1]) || "";
if (!live || !fs.existsSync(live)) {
  console.error("usage: npm run disk:dry-run -- --db <path to agent-os.db>");
  process.exit(1);
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-disk-dry-"));
  const copy = path.join(dir, "agent-os.db");
  try {
    const src = new Database(live, { readonly: true });
    await src.backup(copy);
    src.close();
    process.env.DB_PATH = copy;

    const { sweep, defaultSweepDeps } =
      await import("../lib/worktree-sweep/runSweep");
    const { summary } = await sweep(
      { dryRun: true },
      { ...defaultSweepDeps(), busy: () => false }
    );
    const all = [...summary.removed, ...(summary.pending ?? [])];
    const gb = (b: number) => `${(b / 1024 ** 3).toFixed(2)} GB`;
    for (const kind of new Set(all.map((i) => i.kind))) {
      const items = all.filter((i) => i.kind === kind);
      console.log(
        `${kind}: ${items.length} (${gb(items.reduce((n, i) => n + i.bytes, 0))})`
      );
    }
    console.log(`kept: ${summary.skipped.length}`);
    console.log(`list: ${summary.report ?? "(not written)"}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
