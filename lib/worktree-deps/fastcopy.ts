/**
 * How a Linux (or macOS) worktree can be given a copy of the main checkout's
 * files without paying for every byte: an APFS clone, a reflink where the
 * filesystem has them, or hardlinks from a store AgentOS owns. Null when
 * none works, and the caller installs or copies plainly instead.
 */

import { agentosHome } from "../agentos-home";
import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import type { CopyMode } from "./spare";

const execFileAsync = promisify(execFile);

export type FastMode = Exclude<CopyMode, "copy">;

// Where hardlinked dependencies are kept: one real copy per lockfile, so a
// write through a link can only ever reach this, never the main checkout.
export const STORE_ROOT = agentosHome("deps-store");

// Files tools rewrite in place. A hardlink would carry the write back into
// the store, so these are real copies in every worktree.
export const MUTABLE_IN_MODULES = [
  ".package-lock.json",
  ".modules.yaml",
  ".pnpm/lock.yaml",
  ".pnpm-workspace-state-v1.json",
  ".cache",
  ".vite",
];

const probed = new Map<string, boolean>();

// Whether `dir`'s filesystem reflinks: tried on a scratch file made there.
export async function canReflink(dir: string): Promise<boolean> {
  const dev = String((await fs.promises.stat(dir)).dev);
  const known = probed.get(dev);
  if (known !== undefined) return known;
  const probe = path.join(dir, `.aos-reflink-probe-${process.pid}`);
  let ok = false;
  try {
    await fs.promises.writeFile(probe, "x");
    await execFileAsync("cp", ["--reflink=always", probe, `${probe}.copy`]);
    ok = true;
  } catch {
    ok = false;
  } finally {
    await fs.promises.rm(probe, { force: true });
    await fs.promises.rm(`${probe}.copy`, { force: true });
  }
  probed.set(dev, ok);
  return ok;
}

const device = (p: string) =>
  fs.promises.stat(p).then(
    (s) => s.dev,
    () => null
  );

export async function fastCopyMode(opts: {
  sourcePath: string;
  worktreePath: string;
  storeRoot?: string;
  platform?: NodeJS.Platform;
}): Promise<FastMode | null> {
  const platform = opts.platform ?? process.platform;
  if (platform === "darwin") return "clone";
  if (platform !== "linux") return null;
  const wt = await device(opts.worktreePath);
  if (wt === null) return null;
  if (
    (await device(opts.sourcePath)) === wt &&
    (await canReflink(opts.worktreePath))
  )
    return "reflink";
  const store = opts.storeRoot ?? STORE_ROOT;
  await fs.promises.mkdir(store, { recursive: true }).catch(() => undefined);
  return (await device(store)) === wt ? "hardlink" : null;
}

// Replace the entries of a hardlinked node_modules that tools rewrite in
// place with real copies.
export async function unlinkMutable(modules: string): Promise<void> {
  for (const name of MUTABLE_IN_MODULES) {
    const entry = path.join(modules, name);
    if (!(await fs.promises.lstat(entry).catch(() => null))) continue;
    const copy = `${entry}.aos-copy`;
    await fs.promises.rm(copy, { recursive: true, force: true });
    await fs.promises.cp(entry, copy, { recursive: true });
    await fs.promises.rm(entry, { recursive: true, force: true });
    await fs.promises.rename(copy, entry);
  }
}
