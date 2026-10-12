/**
 * Writes session logs for tasks that merged before logs existed, from what
 * the database still holds. Their plan files went with their worktrees, so
 * each says "plan not kept". Idempotent: a task with a log is skipped.
 *
 *   npx tsx scripts/backfill-session-logs.ts --db <path to agent-os.db> [--no-gh] [--dry]
 *
 * --db is required so a run never lands on a database by accident. Files go
 * where new logs go (~/.agent-os/session-logs, or a project's folder); run
 * with HOME set elsewhere to keep a trial away from the real folder.
 * --no-gh skips asking GitHub for each merge commit.
 */

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const dbPath = args[args.indexOf("--db") + 1];

if (!flag("--db") || !dbPath || dbPath.startsWith("--")) {
  console.error(
    "usage: backfill-session-logs.ts --db <path> [--no-gh] [--dry]"
  );
  process.exit(2);
}
process.env.DB_PATH = dbPath;

async function main() {
  const { db } = await import("../lib/db");
  const { writeLog } = await import("../lib/session-logs");
  const { hasLog } = await import("../lib/session-logs/store");
  const rows = db
    .prepare(
      `SELECT id, name FROM sessions
       WHERE task_prompt IS NOT NULL AND peer_mirror = 0
         AND (task_status = 'merged' OR (pr_status = 'merged' AND task_status != 'dropped'))
       ORDER BY COALESCE(merged_at, updated_at)`
    )
    .all() as { id: string; name: string }[];
  const todo = rows.filter((r) => !hasLog(r.id));
  console.log(
    `${rows.length} merged tasks, ${rows.length - todo.length} already logged, ${todo.length} to write${flag("--dry") ? " (dry run)" : ""}`
  );
  let written = 0;
  for (const r of todo) {
    if (flag("--dry")) {
      console.log(`  would log ${r.name} (${r.id.slice(0, 8)})`);
      continue;
    }
    try {
      const ok = await writeLog(r.id, {
        planKept: false,
        noGh: flag("--no-gh"),
      });
      if (ok) written++;
      console.log(
        `  ${ok ? "logged" : "skipped"} ${r.name} (${r.id.slice(0, 8)})`
      );
    } catch (error) {
      console.error(`  FAILED ${r.name} (${r.id.slice(0, 8)}):`, error);
    }
  }
  console.log(`wrote ${written} logs`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
