/**
 * A throwaway checkout for a fork child that has to edit code to find its
 * answer (`aos fork --worktree`): detached at the parent's HEAD, with the
 * parent's uncommitted changes applied on top, so it sees what the parent
 * sees. No branch is made and nothing from it is merged; it is removed when
 * the child settles.
 */

import fs from "fs";
import path from "path";
import { git } from "../git-exec";
import { setupWorktree } from "../env-setup";
import { forkHome, worktreeOf } from "./scratch";

const MAX_UNTRACKED = 200;
const MAX_UNTRACKED_BYTES = 5_000_000;
// A change to these means the parent's installed packages may not match.
const DEPENDENCY_FILES =
  /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/;

export interface ForkWorktree {
  // Where the child runs: the parent's folder, in the checkout.
  cwd: string;
  // The checkout's root.
  root: string;
  // The parent's packages are linked in instead of installed.
  linked: boolean;
  // The commit it started from, for the child's return.
  head: string;
}

export async function createForkWorktree(opts: {
  childId: string;
  parentCwd: string;
}): Promise<ForkWorktree> {
  const cwd = opts.parentCwd;
  const top = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
  const head = (await git(top, ["rev-parse", "HEAD"])).trim();
  const wt = worktreeOf(opts.childId);
  await fs.promises.mkdir(forkHome(opts.childId), { recursive: true });
  try {
    await git(top, ["worktree", "add", "--detach", "--", wt, head], {
      timeout: 5 * 60_000,
    });
    const diff = await git(top, ["diff", "HEAD", "--binary"], {
      maxBuffer: 64 * 1024 * 1024,
    });
    if (diff.trim())
      await git(wt, ["apply", "--whitespace=nowarn", "--binary", "-"], {
        input: diff,
      });
    await copyUntracked(top, wt);
    const changed = (await git(top, ["diff", "HEAD", "--name-only"]))
      .split("\n")
      .filter(Boolean);
    const hasPackages = await exists(path.join(top, "node_modules"));
    const linked =
      hasPackages && !changed.some((f) => DEPENDENCY_FILES.test(f));
    if (linked)
      await fs.promises.symlink(
        path.join(top, "node_modules"),
        path.join(wt, "node_modules")
      );
    const setup = await setupWorktree({
      worktreePath: wt,
      sourcePath: top,
      skipInstall: linked,
    });
    if (!setup.success)
      throw new Error(
        setup.steps.find((s) => !s.success)?.error ?? "worktree setup failed"
      );
    return {
      cwd: path.join(wt, path.relative(top, cwd)),
      root: wt,
      linked,
      head,
    };
  } catch (error) {
    const { removeFork } = await import("./scratch");
    await removeFork(opts.childId);
    throw error;
  }
}

const exists = (p: string) =>
  fs.promises.access(p).then(
    () => true,
    () => false
  );

// Files the parent made and hasn't added yet, which a diff doesn't carry.
async function copyUntracked(top: string, wt: string): Promise<void> {
  const out = await git(top, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
  const files = out.split("\0").filter(Boolean);
  if (files.length > MAX_UNTRACKED)
    throw new Error(
      `the parent has ${files.length} new files; commit or stage them first`
    );
  for (const rel of files) {
    const from = path.join(top, rel);
    const stat = await fs.promises.lstat(from);
    if (stat.isSymbolicLink() || !stat.isFile()) continue;
    if (stat.size > MAX_UNTRACKED_BYTES)
      throw new Error(`${rel} is too large to carry into a checkout`);
    const to = path.join(wt, rel);
    await fs.promises.mkdir(path.dirname(to), { recursive: true });
    await fs.promises.copyFile(from, to);
  }
}
