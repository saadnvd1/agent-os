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
import { STORE_ROOT, fastCopyMode, unlinkMutable } from "./fastcopy";
import type { FastMode } from "./fastcopy";
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
async function cloneWhole(
  from: string,
  target: string,
  mode: FastMode
): Promise<boolean> {
  const partial = `${target}.aos-partial`;
  await fs.promises.rm(partial, { recursive: true, force: true });
  const ok =
    (await copyTree(from, partial, mode)) && (await takeSpare(partial, target));
  await fs.promises.rm(partial, { recursive: true, force: true });
  return ok;
}

export interface CloneResult {
  ok: boolean;
  // Why it didn't clone, when it didn't.
  reason?: string;
  cloned: Array<{ rel: string; from: "spare" | "clone" }>;
  mode?: FastMode;
  skipped?: string[];
  // The spares being made for the next start. Nothing waits on it but tests.
  refill?: Promise<unknown>;
}

export const NO_FAST_COPY =
  "no clone, reflink or hardlink store is possible here";

export async function cloneDeps(opts: {
  sourcePath: string;
  worktreePath: string;
  // agentos.json's `clone`: exactly these paths. Without it, every
  // node_modules findNodeModules finds.
  only?: string[];
  spareRoot?: string;
  // Where Linux keeps the hardlinked store (fastcopy.ts).
  storeRoot?: string;
  platform?: NodeJS.Platform;
  // Forced instead of detected; null is "none works" (tests).
  mode?: FastMode | null;
}): Promise<CloneResult> {
  const { sourcePath, worktreePath, only } = opts;
  const root = opts.spareRoot ?? SPARE_ROOT;
  const cloned: CloneResult["cloned"] = [];
  const storeRoot = opts.storeRoot ?? STORE_ROOT;
  const mode =
    opts.mode !== undefined
      ? opts.mode
      : await fastCopyMode({
          sourcePath,
          worktreePath,
          storeRoot,
          platform: opts.platform,
        });
  if (!mode) return { ok: false, reason: NO_FAST_COPY, cloned };

  const isModules = (rel: string) => path.basename(rel) === "node_modules";
  const all = only
    ? only.map((rel) => path.normalize(rel).replace(/[/\\]+$/, ""))
    : await findNodeModules(sourcePath);
  const modules = all.filter(isModules);
  // Declared or not, a root node_modules is only cloned against a matching
  // lockfile: otherwise the clone would be the wrong dependencies.
  const lock = await lockfileHash(sourcePath);
  if (!only || modules.includes("node_modules")) {
    if (!(await isDir(path.join(sourcePath, "node_modules"))))
      return {
        ok: false,
        reason: "the main checkout has no node_modules",
        cloned,
      };
    if (!lock)
      return { ok: false, reason: "the main checkout has no lockfile", cloned };
    if (!(await nodeModulesMatchLock(sourcePath)))
      return {
        ok: false,
        reason:
          "the main checkout's node_modules is not what its lockfile lists",
        cloned,
      };
    if (lock !== (await lockfileHash(worktreePath)))
      return {
        ok: false,
        reason: "the worktree's lockfile differs from the main checkout's",
        cloned,
      };
  }

  const spares: Array<{ rel: string; lock: string }> = [];
  const skipped: string[] = [];
  for (const rel of all) {
    const from = path.join(sourcePath, rel);
    const target = path.join(worktreePath, rel);
    if (!(await isDir(from))) continue;
    // A directory this branch doesn't have, or the files already there.
    if (!(await isDir(path.dirname(target))) || fs.existsSync(target)) continue;
    if (!isModules(rel) && mode === "hardlink") {
      // Mutable, and hardlinks would write back: left to the setup commands.
      skipped.push(`${rel} (not linked)`);
      continue;
    }
    if (!isModules(rel)) {
      // Anything else declared (a virtualenv, vendor/bundle) is cloned as
      // is: there is no lockfile AgentOS knows to check it against.
      if (!(await cloneWhole(from, target, mode)))
        return { ok: false, reason: `cloning ${rel} failed`, cloned };
      cloned.push({ rel, from: "clone" });
      continue;
    }
    // A nested project with its own lockfile is cloned only when that
    // lockfile matches too.
    const own = await lockfileHash(path.join(sourcePath, path.dirname(rel)));
    const ownHere = await lockfileHash(path.dirname(target));
    if (rel !== "node_modules" && own !== ownHere) continue;
    const key = own ?? lock;
    if (!key) continue;
    if (mode === "hardlink") {
      // Linked from the store, never from the checkout; the store is made
      // once per lockfile with a plain copy.
      const stored = sparePath(storeRoot, sourcePath, rel, key);
      if (!fs.existsSync(stored))
        await replenishSpare(storeRoot, sourcePath, rel, key, "copy").catch(
          () => undefined
        );
      if (!fs.existsSync(stored))
        return {
          ok: false,
          reason: `making the store for ${rel} failed`,
          cloned,
        };
      if (!(await cloneWhole(stored, target, mode)))
        return { ok: false, reason: `linking ${rel} failed`, cloned };
      await unlinkMutable(target).catch(() => undefined);
      cloned.push({ rel, from: "clone" });
      continue;
    }
    const spare = sparePath(root, sourcePath, rel, key);
    if (await takeSpare(spare, target)) {
      cloned.push({ rel, from: "spare" });
    } else if (await cloneWhole(from, target, mode)) {
      cloned.push({ rel, from: "clone" });
    } else {
      return { ok: false, reason: `cloning ${rel} failed`, cloned };
    }
    spares.push({ rel, lock: key });
  }

  const refill = Promise.all(
    spares.map(({ rel, lock: key }) =>
      replenishSpare(root, sourcePath, rel, key, mode).catch((error) =>
        console.error(`Spare for ${rel} failed:`, error)
      )
    )
  );
  return { ok: true, cloned, refill, mode, skipped };
}

// Whether the checkout's node_modules is what its npm lockfile says: every
// package the lockfile lists (optional ones, which a platform may skip, aside)
// is installed at that version. A checkout pulled but never reinstalled is
// not, and cloning it would hand the worktree missing dependencies. Other
// package managers have no hidden lockfile to check, so they pass.
export async function nodeModulesMatchLock(dir: string): Promise<boolean> {
  // pnpm copies the lockfile it installed from into node_modules/.pnpm.
  const pnpmLock = await fs.promises
    .readFile(path.join(dir, "pnpm-lock.yaml"), "utf-8")
    .catch(() => null);
  if (pnpmLock !== null) {
    const installed = await fs.promises
      .readFile(path.join(dir, "node_modules", ".pnpm", "lock.yaml"), "utf-8")
      .catch(() => null);
    return installed === pnpmLock;
  }
  const read = (file: string) =>
    fs.promises
      .readFile(file, "utf-8")
      .then(
        (text) =>
          JSON.parse(text) as {
            packages?: Record<string, { version?: string; optional?: boolean }>;
          }
      )
      .catch(() => null);
  const lock = await read(path.join(dir, "package-lock.json"));
  if (!lock?.packages) return true;
  const installed = await read(
    path.join(dir, "node_modules", ".package-lock.json")
  );
  if (!installed?.packages) return false;
  return Object.entries(lock.packages).every(
    ([name, pkg]) =>
      name === "" ||
      pkg.optional ||
      installed.packages![name]?.version === pkg.version
  );
}
