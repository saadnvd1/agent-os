/**
 * A session's worktree, saved as one hidden commit before an end removes it:
 * refs/agentos/ended/<session id>, parented on the branch tip, holding the
 * tracked changes, the untracked files and the (git-ignored) plan file. It is
 * built in a temporary index, so the worktree, its index and its branch are
 * never touched, and takes about a tenth of a second.
 *
 * Restoring puts the worktree back on its branch with those files unstaged.
 * Without a snapshot (an end from before this existed, or one that failed) it
 * falls back to the branch, wherever it still exists.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { git as runGit, gitOk } from "../git-exec";
import { PLAN_FILE, preparePlanDir } from "../models/plan-step";
import { addWorktree } from "../worktree-add";
import { installWorktreeHooks } from "../worktree-hooks";

const SNAPSHOT_TIMEOUT_MS = 5000;
// An untracked file bigger than this is left out: a build artefact, not work.
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_FILES = 2000;

const IDENTITY = {
  GIT_AUTHOR_NAME: "AgentOS",
  GIT_AUTHOR_EMAIL: "agentos@localhost",
  GIT_COMMITTER_NAME: "AgentOS",
  GIT_COMMITTER_EMAIL: "agentos@localhost",
};

export const snapshotRef = (sessionId: string) =>
  `refs/agentos/ended/${sessionId}`;

const git = (cwd: string, args: string[], extra: object = {}) =>
  runGit(cwd, args, { timeout: SNAPSHOT_TIMEOUT_MS, ...extra });

async function build(worktree: string, sessionId: string): Promise<string> {
  const [head, indexFile] = (
    await git(worktree, [
      "rev-parse",
      "HEAD",
      "--path-format=absolute",
      "--git-path",
      "index",
    ])
  )
    .trim()
    .split("\n");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aos-snap-"));
  try {
    const index = path.join(tmp, "index");
    if (fs.existsSync(indexFile)) fs.copyFileSync(indexFile, index);
    const env = { GIT_INDEX_FILE: index, ...IDENTITY };
    const opts = { env, literalPathspecs: true };
    await git(worktree, ["add", "-u"], opts);
    const untracked = (
      await git(worktree, ["ls-files", "-o", "--exclude-standard", "-z"])
    )
      .split("\0")
      .filter(Boolean)
      .filter((file) => {
        try {
          const stat = fs.statSync(path.join(worktree, file));
          return stat.isFile() && stat.size <= MAX_FILE_BYTES;
        } catch {
          return false;
        }
      })
      .slice(0, MAX_FILES);
    if (untracked.length)
      await git(worktree, ["add", "--", ...untracked], opts);
    if (fs.existsSync(path.join(worktree, PLAN_FILE)))
      await git(worktree, ["add", "-f", "--", PLAN_FILE], opts);
    const tree = (await git(worktree, ["write-tree"], opts)).trim();
    const commit = (
      await git(
        worktree,
        ["commit-tree", tree, "-p", head, "-m", `ended ${sessionId}`],
        opts
      )
    ).trim();
    await git(worktree, ["update-ref", snapshotRef(sessionId), commit]);
    return commit;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Saves the worktree's work under a hidden ref. Never throws and never waits
 * past its ceiling: a snapshot that fails only means the restore falls back
 * to the branch.
 */
export async function snapshotWorktree(
  worktree: string | null,
  sessionId: string
): Promise<string | null> {
  if (!worktree || process.env.AGENTOS_NO_END_SNAPSHOT) return null;
  const started = Date.now();
  try {
    const commit = await build(worktree, sessionId);
    console.log(
      `[resurrect] snapshot ${sessionId} in ${Date.now() - started} ms`
    );
    return commit;
  } catch (error) {
    console.error(`[resurrect] no snapshot for ${sessionId}:`, error);
    return null;
  }
}

export const hasSnapshot = (repo: string, sessionId: string) =>
  gitOk(repo, ["rev-parse", "--verify", "--quiet", snapshotRef(sessionId)]);

export async function dropSnapshot(
  repo: string,
  sessionId: string
): Promise<void> {
  await gitOk(repo, ["update-ref", "-d", snapshotRef(sessionId)]);
}

export type RestoredAs = "kept" | "snapshot" | "branch" | "origin" | "fresh";

export interface RestoreOptions {
  sessionId: string;
  repo: string;
  branch: string;
  base: string | null;
  // Where it was: used again when free, so Claude's conversation (filed by
  // folder) is found as it is.
  oldPath: string | null;
  // A branch that never held work of its own may be made anew.
  allowFresh: boolean;
}

const addRun = (args: string[], cwd: string) =>
  runGit(cwd, args, { timeout: 120_000 });

const refOk = (repo: string, ref: string) =>
  gitOk(repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);

/** The worktree back, or null when there's nothing to make it from. */
export async function restoreWorktree(
  o: RestoreOptions
): Promise<{ path: string; mode: RestoredAs } | null> {
  if (o.oldPath && fs.existsSync(o.oldPath))
    return { path: o.oldPath, mode: "kept" };
  const free = o.oldPath && !fs.existsSync(o.oldPath);
  // Lazily: branch-worktree reaches back into the tasks code that ends sessions.
  const { worktreeDirFor } = await import("../tasks/branch-worktree");
  const dir = free ? o.oldPath! : worktreeDirFor(o.repo, o.branch);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  await git(o.repo, ["worktree", "prune"]).catch(() => "");
  const snap = snapshotRef(o.sessionId);
  let mode: RestoredAs;
  if (await refOk(o.repo, snap)) {
    await addWorktree(addRun, o.repo, dir, `${snap}^`, ["-B", o.branch]);
    mode = "snapshot";
  } else if (await refOk(o.repo, `refs/heads/${o.branch}`)) {
    await addWorktree(addRun, o.repo, dir, o.branch);
    mode = "branch";
  } else if (await fetchBranch(o.repo, o.branch)) {
    await addWorktree(addRun, o.repo, dir, `origin/${o.branch}`, [
      "-B",
      o.branch,
    ]);
    await git(dir, ["branch", "--set-upstream-to", `origin/${o.branch}`]).catch(
      () => ""
    );
    mode = "origin";
  } else if (o.allowFresh) {
    const base = o.base || "main";
    const start = (await refOk(o.repo, `origin/${base}`))
      ? `origin/${base}`
      : base;
    await addWorktree(addRun, o.repo, dir, start, ["-b", o.branch]);
    mode = "fresh";
  } else return null;
  await installWorktreeHooks(dir).catch(() => "");
  if (mode === "snapshot") await layFiles(dir, snap);
  return { path: dir, mode };
}

async function fetchBranch(repo: string, branch: string): Promise<boolean> {
  const ok = await gitOk(
    repo,
    [
      "fetch",
      "-q",
      "origin",
      `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
    ],
    { timeout: 60_000 }
  );
  return ok && refOk(repo, `origin/${branch}`);
}

// The snapshot's files over the fresh checkout, left as uncommitted changes.
async function layFiles(dir: string, snap: string): Promise<void> {
  const deleted = (
    await runGit(dir, [
      "diff",
      "--name-only",
      "--diff-filter=D",
      "-z",
      "HEAD",
      snap,
    ])
  )
    .split("\0")
    .filter(Boolean);
  await runGit(dir, ["checkout", snap, "--", "."]);
  await runGit(dir, ["reset", "-q"]);
  for (const file of deleted) fs.rmSync(path.join(dir, file), { force: true });
  // Its .gitignore isn't in the snapshot: without it the plan reads as new.
  if (fs.existsSync(path.join(dir, PLAN_FILE))) preparePlanDir(dir);
}
