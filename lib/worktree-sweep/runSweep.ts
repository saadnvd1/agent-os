/**
 * One clean-up run: settled sessions' worktrees and orphan folders, each
 * judged, removed when nothing would be lost, skipped with a reason when not.
 * The branch and the conversation stay; a restore rebuilds the worktree.
 */

import fs from "fs";
import path from "path";
import { db, type Session } from "../db";
import { git as runGit } from "../git-exec";
import { run as runCmd } from "../tasks/gh";
import { deleteWorktree, WORKTREES_DIR } from "../worktrees";
import { keepSessionFiles } from "../session-artifacts/collect";
import { currentLevel } from "../load/monitor";
import {
  findSettled,
  defaultSettledDeps,
  type SettledDeps,
} from "./findSettled";
import { findOrphans, holdsNothing } from "./findOrphans";
import duBytes from "./du";
import { findExtras, defaultExtras, type Extras } from "./extras";
import { reaperArmed } from "./settings";
import { writeDiskReport } from "./report";
import { judgeWorktree } from "./judge";
import { openPaneFolders } from "./panes";
import { finishRun, recordSwept, startRun } from "./store";
import { ARMED_KINDS, type Candidate, type SweepSummary } from "./types";

export interface SweepDeps {
  now: number;
  root: string;
  panes: () => Promise<string[]>;
  settled: Omit<SettledDeps, "now" | "panes">;
  size: (dir: string) => Promise<number>;
  prHead: (repo: string, number: number) => Promise<string | null>;
  // Stop early when the machine is busy.
  busy: () => boolean;
  // Task databases, spares, temp folders and build caches.
  extras: (opts?: { fresh?: boolean }) => Promise<Extras>;
  // Written by a dry run: where its list goes.
  report: (summary: SweepSummary) => string | null;
}

const git = (cwd: string, ...args: string[]) =>
  runGit(cwd, args, { timeout: 30_000 }).then((o) => o.trim());

async function prHeadOf(repo: string, number: number): Promise<string | null> {
  try {
    const out = await runCmd(
      "gh",
      [
        "pr",
        "view",
        String(number),
        "--json",
        "headRefOid",
        "-q",
        ".headRefOid",
      ],
      repo,
      30_000
    );
    return out.trim() || null;
  } catch {
    return null;
  }
}

export const defaultSweepDeps = (): SweepDeps => ({
  now: Date.now(),
  root: WORKTREES_DIR,
  panes: openPaneFolders,
  settled: defaultSettledDeps(),
  size: (dir) => duBytes(dir, 120_000),
  prHead: prHeadOf,
  busy: () => currentLevel() === "red",
  extras: defaultExtras,
  report: (summary) => {
    try {
      return writeDiskReport(summary);
    } catch (error) {
      console.error("[worktree-sweep] report not written:", error);
      return null;
    }
  },
});

// A path under the root, never the root itself or something outside it.
const inRoot = (root: string, p: string) => {
  const rel = path.relative(path.resolve(root), path.resolve(p));
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
};

async function repoOfSession(c: Candidate): Promise<string | null> {
  if (c.repo) return c.repo;
  try {
    return (
      await git(
        c.path,
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir"
      )
    ).replace(/\/\.git\/?$/, "");
  } catch {
    return null;
  }
}

async function removeOne(
  c: Candidate,
  repo: string | null,
  runId: number
): Promise<void> {
  if (c.sessionId) {
    await keepSessionFiles(c.sessionId).catch(() => {});
    recordSwept(c.sessionId, c.path, c.branch ?? null, runId);
  }
  if (repo && fs.existsSync(repo) && c.kind !== "test-leak")
    await deleteWorktree(c.path, repo, false).catch(() => {});
  if (fs.existsSync(c.path))
    await fs.promises.rm(c.path, { recursive: true, force: true });
  if (repo && fs.existsSync(repo))
    await git(repo, "worktree", "prune").catch(() => "");
}

export async function sweep(
  opts: { dryRun?: boolean } = {},
  deps: SweepDeps = defaultSweepDeps()
): Promise<{ runId: number; summary: SweepSummary }> {
  const dryRun = !!opts.dryRun;
  const runId = startRun(dryRun);
  const armed = reaperArmed();
  const summary: SweepSummary = {
    removed: [],
    skipped: [],
    freedBytes: 0,
    pending: [],
    armed,
  };
  let error: string | null = null;
  try {
    const panes = await deps.panes();
    const s = await findSettled({ ...deps.settled, now: deps.now, panes });
    const o = await findOrphans({ now: deps.now, root: deps.root, panes });
    // Reasons that need a look come before the ones that only need time.
    const young = (k: { reason: string }) => /less than \d+ day/.test(k.reason);
    summary.skipped.push(
      ...[...s.skipped, ...o.skipped].sort(
        (a, b) => Number(young(a)) - Number(young(b))
      )
    );
    const pruned = new Set<string>();
    for (const c of [...s.candidates, ...o.candidates]) {
      if (deps.busy()) {
        summary.skipped.push({
          path: c.path,
          kind: c.kind,
          reason: "the machine is busy; left for the next run",
          sessionId: c.sessionId,
        });
        continue;
      }
      if (!inRoot(deps.root, c.path)) continue;
      const skip = (reason: string) =>
        summary.skipped.push({
          path: c.path,
          kind: c.kind,
          reason,
          sessionId: c.sessionId,
        });
      if (ARMED_KINDS.has(c.kind) && !armed) {
        summary.pending!.push({
          path: c.path,
          kind: c.kind,
          why:
            c.kind === "test-leak"
              ? "a test's throwaway repository"
              : "an orphan worktree",
          bytes: await deps.size(c.path),
        });
        continue;
      }
      const repo = await repoOfSession(c);
      const why =
        c.kind === "test-leak"
          ? "a test's throwaway repository"
          : "clean and nothing would be lost";
      if (c.kind !== "test-leak" && (repo || c.kind === "settled")) {
        if (!repo) {
          // Git can't read it: it goes only when it holds nothing of anyone's.
          if (!holdsNothing(c.path)) {
            skip("it isn't a git worktree any more");
            continue;
          }
        } else {
          let verdict = await judgeWorktree(c.path, repo, { branch: c.branch });
          // A squash merge leaves the branch's commits only in the PR's head.
          if (!verdict.remove && c.prNumber) {
            const prHead = await deps.prHead(repo, c.prNumber);
            if (prHead)
              verdict = await judgeWorktree(c.path, repo, {
                branch: c.branch,
                prHead,
              });
          }
          if (!verdict.remove) {
            skip(verdict.reason);
            continue;
          }
        }
      }
      const bytes = await deps.size(c.path);
      if (!dryRun) {
        await removeOne(c, repo, runId);
        if (fs.existsSync(c.path)) {
          skip("removing it failed");
          continue;
        }
        if (repo) pruned.add(repo);
      }
      summary.removed.push({
        path: c.path,
        kind: c.kind,
        why,
        bytes,
        sessionId: c.sessionId,
      });
      summary.freedBytes += bytes;
    }
    if (!dryRun) await pruneProjects([...pruned]);
    const extras = await findExtras(deps, summary, { armed, dryRun });
    summary.totals = extras.totals;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  if (dryRun) summary.report = deps.report(summary) ?? undefined;
  finishRun(runId, summary, error);
  console.log(describeRun(summary, dryRun, error));
  return { runId, summary };
}

// `git worktree prune` in every repository AgentOS knows, so entries for
// folders that are gone stop piling up.
async function pruneProjects(extra: string[]): Promise<void> {
  const rows = db
    .prepare(
      `SELECT working_directory FROM projects WHERE working_directory IS NOT NULL`
    )
    .all() as Array<Pick<Session, "working_directory">>;
  const repos = new Set([...extra, ...rows.map((r) => r.working_directory)]);
  for (const repo of repos)
    if (repo && fs.existsSync(repo))
      await git(repo, "worktree", "prune").catch(() => "");
}

const gb = (b: number) => `${(b / 1024 ** 3).toFixed(2)} GB`;

export function describeRun(
  s: SweepSummary,
  dryRun = false,
  error: string | null = null
): string {
  const reasons = new Map<string, number>();
  for (const k of s.skipped) {
    const r = k.reason.replace(/\(.*\)/, "").trim();
    reasons.set(r, (reasons.get(r) ?? 0) + 1);
  }
  const why = [...reasons].map(([r, n]) => `${n} ${r}`).join("; ");
  const leaks = s.removed.filter((r) => r.kind === "test-leak").length;
  const pending = s.pending?.length
    ? `, ${s.pending.length} more (${gb(s.pending.reduce((n, p) => n + p.bytes, 0))}) wait for the full clean-up to be turned on`
    : "";
  return `[worktree-sweep] ${dryRun ? "would remove" : "removed"} ${s.removed.length} (${gb(s.freedBytes)}${leaks ? `, ${leaks} test leftovers` : ""})${pending}, skipped ${s.skipped.length}${why ? `: ${why}` : ""}${error ? `; failed: ${error}` : ""}`;
}
