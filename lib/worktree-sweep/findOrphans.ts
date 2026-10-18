/**
 * Folders in the worktrees root that no session owns. Old ones go, after the
 * same checks as a settled worktree; the throwaway repos tests once left
 * there (they hold nothing of anyone's) go without them.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { db } from "../db";
import { mainCheckoutOf } from "../worktrees";
import { resolveSweepDays } from "./settings";
import { inFolder } from "./panes";
import type { Candidate, SweepSkipped } from "./types";

const DAY_MS = 24 * 3600_000;

// What a test's quick-change worktree is called (lib/orchestrator/quick.test.ts).
const TEST_LEAK = /^(aos-quick-repo-|repo-quick-)/;
// Kept in a folder AgentOS made that holds no work: placed or rebuilt files.
const DISPOSABLE = new Set([
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "build",
  ".git",
  ".dev-tmux",
  ".agent-os",
]);

const real = (p: string) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

// Every folder a session row names, on any machine's row: never an orphan.
function owned(): Set<string> {
  const rows = db
    .prepare(
      `SELECT worktree_path AS a, working_directory AS b FROM session_rows`
    )
    .all() as Array<{ a: string | null; b: string | null }>;
  const out = new Set<string>();
  for (const r of rows) for (const p of [r.a, r.b]) if (p) out.add(real(p));
  return out;
}

// Where a worktree's .git file points; null when it has none.
function gitdirOf(dir: string): string | null {
  try {
    const m = /^gitdir:\s*(.+)$/m.exec(
      fs.readFileSync(path.join(dir, ".git"), "utf8")
    );
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

// The server's own temp folder differs from a test run's (launchd, systemd),
// so the usual system ones count too.
const TEMP_ROOTS = [
  /^\/(?:private\/)?tmp(?:\/|$)/,
  /^\/(?:private\/)?var\/folders\/[^/]+\/[^/]+\/T(?:\/|$)/,
  /^\/var\/tmp(?:\/|$)/,
];
const inTemp = (p: string) =>
  [os.tmpdir(), real(os.tmpdir())].some((t) => inFolder(p, t)) ||
  TEMP_ROOTS.some((r) => r.test(p));

// Nothing in it but what AgentOS placed or rebuilds: no work to lose.
export const holdsNothing = (dir: string) =>
  fs
    .readdirSync(dir)
    .filter((f) => !DISPOSABLE.has(f))
    .every((f) => f.startsWith(".env"));

const newestMs = (dir: string) => {
  let t = 0;
  for (const p of [dir, path.join(dir, ".git")])
    try {
      t = Math.max(t, fs.statSync(p).mtimeMs);
    } catch {
      // not there
    }
  return t;
};

export interface OrphanDeps {
  now: number;
  root: string;
  panes: string[];
}

export async function findOrphans(deps: OrphanDeps): Promise<{
  candidates: Candidate[];
  skipped: SweepSkipped[];
}> {
  const { days } = resolveSweepDays(null);
  const candidates: Candidate[] = [];
  const skipped: SweepSkipped[] = [];
  if (days === 0 || !fs.existsSync(deps.root)) return { candidates, skipped };
  const mine = owned();
  for (const entry of fs.readdirSync(deps.root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = path.join(deps.root, entry.name);
    if (mine.has(real(dir))) continue;
    const skip = (reason: string) =>
      skipped.push({ path: dir, kind: "orphan", reason });
    const gitdir = gitdirOf(dir);
    const registered = !!gitdir && fs.existsSync(gitdir);
    const leak =
      TEST_LEAK.test(entry.name) &&
      !!gitdir &&
      inTemp(real(path.dirname(gitdir)));
    // A test's folder whose repository is gone is nobody's, however young:
    // new ones arrive with every run of an old checkout's tests.
    const abandoned = leak && !registered;
    if (!abandoned && deps.now - newestMs(dir) < days * DAY_MS) {
      skip(`touched less than ${days} day${days === 1 ? "" : "s"} ago`);
      continue;
    }
    if (deps.panes.some((p) => inFolder(p, real(dir)) || inFolder(p, dir))) {
      skip("a terminal is open in it");
      continue;
    }
    if (leak) {
      candidates.push({
        path: dir,
        kind: "test-leak",
        repo: registered ? path.resolve(gitdir!, "../../..") : undefined,
      });
      continue;
    }
    if (registered) {
      const repo = await mainCheckoutOf(dir);
      if (!repo) skip("its repository can't be found");
      else candidates.push({ path: dir, kind: "orphan", repo });
      continue;
    }
    // Not a git worktree any more: git can't say what's in it.
    if (holdsNothing(dir)) candidates.push({ path: dir, kind: "orphan" });
    else skip("it isn't a git worktree and holds files git can't check");
  }
  return { candidates, skipped };
}
