// Times conversation search on a copy of a real database.
//   npx tsx scripts/bench-conversation-search.ts <path to agent-os.db>
// The source is only read (SQLite's online backup); everything else happens on
// the copy, which is removed afterwards.
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const source = process.argv[2];
if (!source) {
  console.error("usage: bench-conversation-search.ts <agent-os.db>");
  process.exit(2);
}
const dir = mkdtempSync(join(tmpdir(), "aos-bench-"));
const copy = join(dir, "bench.db");

const QUERIES = [
  "co",
  "the",
  "compac",
  "worktree",
  '"merge gate"',
  "sqlite fts",
  "orchestrator brake",
  "pull request",
  "a-b: c++",
  "xyzzyplugh",
];
const RUNS = 20;

async function main() {
  const src = new Database(source, { readonly: true });
  await src.backup(copy);
  src.close();
  process.env.DB_PATH = copy;
  const { getDb } = await import("../lib/db");
  const { backfillStep } = await import("../lib/search/conversations/backfill");
  const { searchConversations } =
    await import("../lib/search/conversations/searchConversations");
  const db = getDb();
  const t0 = performance.now();
  while (!backfillStep(db));
  const backfillMs = Math.round(performance.now() - t0);
  const rows = db
    .prepare(`SELECT COUNT(*) AS n FROM chat_search_keys`)
    .get() as { n: number };
  const size = db
    .prepare(
      `SELECT SUM(pgsize) AS b FROM dbstat WHERE name LIKE 'chat_search%'`
    )
    .get() as { b: number };
  console.log(
    `indexed ${rows.n} messages in ${backfillMs} ms; index ${(size.b / 1048576).toFixed(1)} MB`
  );
  for (const q of QUERIES) {
    const ms: number[] = [];
    let groups = 0;
    for (let i = 0; i < RUNS; i++) {
      const t = performance.now();
      groups = searchConversations(q, { workspace: "all" }).groups.length;
      ms.push(performance.now() - t);
    }
    ms.sort((a, b) => a - b);
    const at = (p: number) =>
      ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
    console.log(
      `${q.padEnd(22)} p50 ${at(0.5).toFixed(1).padStart(5)} ms  p95 ${at(0.95).toFixed(1).padStart(5)} ms  ${groups} sessions`
    );
  }
}

main().finally(() => rmSync(dir, { recursive: true, force: true }));
