/**
 * Bring a new worktree the main checkout's node_modules by cloning them
 * (macOS, APFS: seconds and no extra disk) instead of installing (minutes,
 * and a network round trip per package). Only when the worktree's lockfile
 * is the checkout's, byte for byte: otherwise the clone would be the wrong
 * dependencies, and the caller installs instead.
 */

import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { LOCKFILES } from "./install";
import {
  SPARE_ROOT,
  copyTree,
  replenishSpare,
  sparePath,
  takeSpare,
} from "./spare";

export async function lockfileHash(dir: string): Promise<string | null> {
  for (const file of LOCKFILES) {
    const content = await fs.promises
      .readFile(path.join(dir, file))
      .catch(() => null);
    if (content) {
      return createHash("sha256")
        .update(file)
        .update("\0")
        .update(content)
        .digest("hex")
        .slice(0, 12);
    }
  }
  return null;
}

const isDir = (p: string) =>
  fs.promises.stat(p).then(
    (s) => s.isDirectory(),
    () => false
  );

async function subdirs(dir: string): Promise<string[]> {
  const entries = await fs.promises
    .readdir(dir, { withFileTypes: true })
    .catch(() => [] as fs.Dirent[]);
  return entries
    .filter(
      (e) =>
        e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules"
    )
    .map((e) => e.name);
}

// The checkout's node_modules: the root one, then workspace ones up to two
// levels down (web/node_modules, apps/web/node_modules).
export async function findNodeModules(sourcePath: string): Promise<string[]> {
  const found: string[] = [];
  if (await isDir(path.join(sourcePath, "node_modules")))
    found.push("node_modules");
  for (const a of await subdirs(sourcePath)) {
    if (await isDir(path.join(sourcePath, a, "node_modules")))
      found.push(path.join(a, "node_modules"));
    for (const b of await subdirs(path.join(sourcePath, a))) {
      if (await isDir(path.join(sourcePath, a, b, "node_modules")))
        found.push(path.join(a, b, "node_modules"));
    }
  }
  return found;
}

// Cloned beside the target and renamed into place, so a clone cut off by a
// restart or a failed cp never passes for a finished one.
async function cloneWhole(from: string, target: string): Promise<boolean> {
  const partial = `${target}.aos-partial`;
  await fs.promises.rm(partial, { recursive: true, force: true });
  const ok =
    (await copyTree(from, partial)) && (await takeSpare(partial, target));
  await fs.promises.rm(partial, { recursive: true, force: true });
  return ok;
}

export interface CloneResult {
  ok: boolean;
  // Why it didn't clone, when it didn't.
  reason?: string;
  cloned: Array<{ rel: string; from: "spare" | "clone" }>;
  // The spares being made for the next start. Nothing waits on it but tests.
  refill?: Promise<unknown>;
}

export async function cloneDeps(opts: {
  sourcePath: string;
  worktreePath: string;
  spareRoot?: string;
  platform?: NodeJS.Platform;
}): Promise<CloneResult> {
  const { sourcePath, worktreePath } = opts;
  const root = opts.spareRoot ?? SPARE_ROOT;
  const cloned: CloneResult["cloned"] = [];
  if ((opts.platform ?? process.platform) !== "darwin")
    return { ok: false, reason: "clones are macOS only", cloned };

  const all = await findNodeModules(sourcePath);
  if (!all.includes("node_modules"))
    return {
      ok: false,
      reason: "the main checkout has no node_modules",
      cloned,
    };
  const lock = await lockfileHash(sourcePath);
  if (!lock)
    return { ok: false, reason: "the main checkout has no lockfile", cloned };
  if (lock !== (await lockfileHash(worktreePath)))
    return {
      ok: false,
      reason: "the worktree's lockfile differs from the main checkout's",
      cloned,
    };

  const spares: Array<{ rel: string; lock: string }> = [];
  for (const rel of all) {
    const target = path.join(worktreePath, rel);
    // A workspace directory this branch doesn't have, or deps already there.
    if (!(await isDir(path.dirname(target))) || fs.existsSync(target)) continue;
    // A nested project with its own lockfile is cloned only when that
    // lockfile matches too.
    const own = await lockfileHash(path.join(sourcePath, path.dirname(rel)));
    const ownHere = await lockfileHash(path.dirname(target));
    if (rel !== "node_modules" && own !== ownHere) continue;
    const key = own ?? lock;
    const spare = sparePath(root, sourcePath, rel, key);
    if (await takeSpare(spare, target)) {
      cloned.push({ rel, from: "spare" });
    } else if (await cloneWhole(path.join(sourcePath, rel), target)) {
      cloned.push({ rel, from: "clone" });
    } else {
      return { ok: false, reason: `cloning ${rel} failed`, cloned };
    }
    spares.push({ rel, lock: key });
  }

  const refill = Promise.all(
    spares.map(({ rel, lock: key }) =>
      replenishSpare(root, sourcePath, rel, key).catch((error) =>
        console.error(`Spare for ${rel} failed:`, error)
      )
    )
  );
  return { ok: true, cloned, refill };
}
