/**
 * A ready-made clone of a checkout's node_modules, waiting for the next
 * worktree. Even an APFS clone of a big node_modules takes seconds (it is
 * per-file metadata), while a rename on the same volume is instant, so the
 * clone is made after a start, in the background, for the next one to take.
 *
 * A spare is named for its checkout directory and its lockfile's digest, so
 * one made before the dependencies changed is never taken, and is pruned.
 */

import { createHash } from "crypto";
import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export const SPARE_ROOT = path.join(os.homedir(), ".agent-os", "spare");

// A half-built spare left by a restart is removed after this long.
const BUILDING_TTL_MS = 30 * 60 * 1000;

const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex").slice(0, 12);

function sparePrefix(sourcePath: string, rel: string): string {
  return digest(`${path.resolve(sourcePath)}\0${rel}`);
}

export function sparePath(
  root: string,
  sourcePath: string,
  rel: string,
  lockHash: string
): string {
  return path.join(root, `${sparePrefix(sourcePath, rel)}-${lockHash}`);
}

// Move the waiting spare to `target`. False when there is none, or another
// start took it first: a plain clone is the answer then.
export async function takeSpare(
  spare: string,
  target: string
): Promise<boolean> {
  try {
    await fs.promises.rename(spare, target);
    return true;
  } catch {
    return false;
  }
}

// macOS clones (APFS, no extra disk); elsewhere this is a plain copy, which
// production never asks for: Linux worktrees install instead.
export const cloneArgs = (from: string, to: string) =>
  process.platform === "darwin" ? ["-Rc", from, to] : ["-R", from, to];

// A clone that stalls (a locked or dying volume) is killed rather than
// holding a task's start forever.
const COPY_TIMEOUT_MS = 10 * 60 * 1000;

export function copyTree(from: string, to: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("cp", cloneArgs(from, to), {
      stdio: "ignore",
      timeout: COPY_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

// Spares of the same directory with another lockfile digest, and building
// copies a restart abandoned.
export async function pruneSpares(
  root: string,
  sourcePath: string,
  rel: string,
  keep: string
): Promise<string[]> {
  const prefix = `${sparePrefix(sourcePath, rel)}-`;
  const names = await fs.promises.readdir(root).catch(() => [] as string[]);
  const removed: string[] = [];
  for (const name of names) {
    const full = path.join(root, name);
    if (!name.startsWith(prefix) || full === keep) continue;
    if (name.includes(".")) {
      const stat = await fs.promises.stat(full).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs < BUILDING_TTL_MS) continue;
    }
    await fs.promises.rm(full, { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}

const building = new Set<string>();

// Make the spare for the next start unless one is there or on its way. It
// is built under a temporary name and renamed at the end, so a half-made
// clone is never taken; a rename onto a spare another build finished first
// fails, and the extra copy is removed.
export async function replenishSpare(
  root: string,
  sourcePath: string,
  rel: string,
  lockHash: string
): Promise<"made" | "exists" | "failed"> {
  const spare = sparePath(root, sourcePath, rel, lockHash);
  if (building.has(spare) || fs.existsSync(spare)) return "exists";
  building.add(spare);
  try {
    await fs.promises.mkdir(root, { recursive: true });
    await pruneSpares(root, sourcePath, rel, spare);
    const tmp = `${spare}.${process.pid}-${Date.now()}`;
    let made = await copyTree(path.join(sourcePath, rel), tmp);
    if (made) made = await takeSpare(tmp, spare);
    await fs.promises.rm(tmp, { recursive: true, force: true });
    return made ? "made" : "failed";
  } finally {
    building.delete(spare);
  }
}
