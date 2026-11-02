/**
 * A fork child's own folders under the data root: a scratch folder for temp
 * work (scripts, repros, notes), and, when it was asked for, its own
 * checkout. Settling a child removes nothing: they are kept while its
 * session is open, and tidied up after it closes only when nothing in them
 * would be lost. Deleting the child's session is the one thing that removes
 * them whatever they hold.
 */

import fs from "fs";
import path from "path";
import { agentosHome } from "../agentos-home";
import { git } from "../git-exec";
import { describeChanges } from "../worktree-placed";

export const forksRoot = () => agentosHome("forks");
export const forkHome = (childId: string) => agentosHome("forks", childId);
export const scratchOf = (childId: string) =>
  path.join(forkHome(childId), "scratch");
export const worktreeOf = (childId: string) =>
  path.join(forkHome(childId), "wt");

// The tree the checkout started from (the parent's changes and what setup
// placed included), so what the child changed can be told from it.
export const baseOf = (childId: string) => path.join(forkHome(childId), "base");

const MAX_LISTED = 50;

// A tree of the checkout as it is now, taken through a temporary index so
// the child's own index is left alone. Ignored files aren't in it.
export async function snapshotTree(
  wt: string,
  childId: string
): Promise<string> {
  const index = path.join(forkHome(childId), "index.tmp");
  const env = { GIT_INDEX_FILE: index };
  try {
    await git(wt, ["read-tree", "HEAD"], { env });
    await git(wt, ["add", "-A", "--", ".", ":(exclude)node_modules"], { env });
    return (await git(wt, ["write-tree"], { env })).trim();
  } finally {
    await fs.promises.rm(index, { force: true });
  }
}

async function filesUnder(dir: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.promises
    .readdir(path.join(dir, rel), { withFileTypes: true })
    .catch(() => []);
  for (const e of entries) {
    if (out.length >= MAX_LISTED) break;
    const r = path.join(rel, e.name);
    if (e.isDirectory()) out.push(...(await filesUnder(dir, r)));
    else out.push(r);
  }
  return out.slice(0, MAX_LISTED);
}

// What removing the child's folders would lose: files in its scratch, and
// changes in its checkout since it started. Null when that can't be told.
export async function forkLosses(childId: string): Promise<string[] | null> {
  const lost = (await filesUnder(scratchOf(childId))).map(
    (f) => `scratch/${f}`
  );
  const wt = worktreeOf(childId);
  if (fs.existsSync(wt)) {
    try {
      const base = (
        await fs.promises.readFile(baseOf(childId), "utf8").catch(() => "")
      ).trim();
      if (base) {
        const now = await snapshotTree(wt, childId);
        const names = await git(wt, ["diff", "--name-only", base, now]);
        lost.push(...names.split("\n").filter(Boolean));
      } else {
        const st = await git(wt, ["status", "--porcelain"]);
        lost.push(
          ...st
            .split("\n")
            .filter(Boolean)
            .map((l) => l.slice(3))
        );
      }
    } catch {
      return null;
    }
  }
  return lost;
}

// Removes the child's folders only when nothing in them would be lost.
export async function tidyFork(childId: string): Promise<boolean> {
  if (!fs.existsSync(forkHome(childId))) return true;
  const lost = await forkLosses(childId);
  if (lost?.length === 0) {
    await removeFork(childId);
    return true;
  }
  console.log(
    `[forks] kept ${childId}: ${lost ? describeChanges(lost) : "it couldn't be checked"}`
  );
  return false;
}

// Made on demand, so a settled child that is talked to again has one.
export async function ensureScratch(childId: string): Promise<string> {
  const dir = scratchOf(childId);
  await fs.promises.mkdir(dir, { recursive: true });
  return dir;
}

// The folder's real repository, for taking a worktree out of its list.
async function repoOf(wt: string): Promise<string | null> {
  try {
    const common = (
      await git(wt, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
    ).trim();
    return path.dirname(common);
  } catch {
    return null;
  }
}

// Everything of the child's, the worktree first so git forgets it.
export async function removeFork(childId: string): Promise<void> {
  const home = forkHome(childId);
  const wt = worktreeOf(childId);
  if (fs.existsSync(wt)) {
    const repo = await repoOf(wt);
    if (repo)
      await git(repo, ["worktree", "remove", "--force", "--", wt]).catch(
        () => undefined
      );
  }
  await fs.promises.rm(home, { recursive: true, force: true, maxRetries: 3 });
}

// Folders of children whose session is closed or gone, tidied the same safe
// way: what a crash left, and children closed after they settled. `keep`
// says whose folders are still in use. Patches beside the folders stay.
export async function sweepForks(
  keep: (childId: string) => boolean
): Promise<{ removed: number; kept: number }> {
  const root = forksRoot();
  const entries = await fs.promises
    .readdir(root, { withFileTypes: true })
    .catch(() => []);
  let removed = 0;
  let kept = 0;
  for (const e of entries) {
    if (!e.isDirectory() || keep(e.name)) continue;
    if (await tidyFork(e.name)) removed++;
    else kept++;
  }
  return { removed, kept };
}
