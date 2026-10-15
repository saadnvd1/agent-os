/**
 * Writes session logs for tasks that merged before logs existed, from what
 * the database still holds. Their plan files went with their worktrees, so
 * each says "plan not kept". Idempotent: a task with a log is skipped, unless --rewrite.
 *
 *   npx tsx scripts/backfill-session-logs.ts --db <path to agent-os.db> [--no-gh] [--dry] [--dry-run] [--rewrite] [--reexport]
 *
 * --db is required so a run never lands on a database by accident. Files go
 * where new logs go: a project's folder, else the workspace's HQ repo (one
 * commit per HQ at the end of the run), else ~/.agent-os/session-logs; run
 * with HOME set elsewhere to keep a trial away from the real folder.
 * --no-gh skips asking GitHub for each merge commit and time.
 * --reexport writes the files of logs already in the database to where they
 * go now, from the stored markdown (no rebuild, no model), and writes no new
 * logs. Old files are left in place.
 * --rewrite regenerates logs that exist (row and file updated in place, a
 * kept plan stays); no model is called, only the one gh call per PR.
 * --dry-run prints how many logs would be written or change, and writes none.
 */

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const dbPath = args[args.indexOf("--db") + 1];

if (!flag("--db") || !dbPath || dbPath.startsWith("--")) {
  console.error(
    "usage: backfill-session-logs.ts --db <path> [--no-gh] [--dry] [--dry-run] [--rewrite] [--reexport]"
  );
  process.exit(2);
}
process.env.DB_PATH = dbPath;

type Visibility = "private" | "internal" | "none";

async function main() {
  if (flag("--reexport")) {
    const { reexportLogs } = await import("../lib/session-logs/reexport");
    const r = await reexportLogs({ dry: flag("--dry"), log: console.log });
    console.log(
      `${r.moved} ${flag("--dry") ? "to move" : "moved"}, ${r.unchanged} already in place, ${r.failed} failed, ${r.committed} committed`
    );
    return;
  }
  const { db } = await import("../lib/db");
  const { writeLog } = await import("../lib/session-logs");
  const { hasLog } = await import("../lib/session-logs/store");
  const { commitLogs } = await import("../lib/session-logs/hq");
  const rows = db
    .prepare(
      `SELECT id, name FROM session_rows
       WHERE task_prompt IS NOT NULL AND peer_mirror = 0
         AND (task_status = 'merged' OR (pr_status = 'merged' AND task_status != 'dropped'))
       ORDER BY COALESCE(merged_at, updated_at)`
    )
    .all() as { id: string; name: string }[];
  const rewrite = flag("--rewrite");
  const dry = flag("--dry") || flag("--dry-run");
  const todo = rewrite ? rows : rows.filter((r) => !hasLog(r.id));
  console.log(
    `${rows.length} merged tasks, ${rows.length - rows.filter((r) => !hasLog(r.id)).length} already logged, ${todo.length} to ${rewrite ? "regenerate" : "write"}${dry ? " (dry run)" : ""}`
  );
  let written = 0;
  const byHq = new Map<string, { files: string[]; visibility: Visibility }>();
  for (const r of todo) {
    try {
      const ok = await writeLog(r.id, {
        planKept: false,
        noGh: flag("--no-gh"),
        onFile: (file, hq) => {
          const e = byHq.get(hq.dir) ?? {
            files: [],
            visibility: hq.visibility,
          };
          e.files.push(file);
          byHq.set(hq.dir, e);
        },
        rewrite,
        dryRun: dry,
      });
      if (ok) written++;
      console.log(
        `  ${ok ? (dry ? "would change" : rewrite ? "rewrote" : "logged") : "skipped"} ${r.name} (${r.id.slice(0, 8)})`
      );
    } catch (error) {
      console.error(`  FAILED ${r.name} (${r.id.slice(0, 8)}):`, error);
    }
  }
  for (const [dir, { files, visibility }] of byHq)
    await commitLogs(
      dir,
      files,
      `session logs: ${files.length} backfilled`,
      visibility
    );
  console.log(
    `${dry ? `${written} logs would change` : `wrote ${written} logs`}`
  );
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
