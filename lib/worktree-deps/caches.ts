/**
 * Build caches seeded into a new worktree from the main checkout, so its
 * first typecheck, test and build start warm: `.next/cache`, `.next/dev/cache`
 * and `*.tsbuildinfo` for a Node project, or exactly agentos.json's `caches`.
 * (Vitest's own cache is not a default: it only orders tests, and seeding it
 * measured no gain.) A cache is seeded only when it is fresh, built since the
 * worktree's base commit, and not huge: an old one makes the first run
 * slower, not faster. Best effort: a cache that can't be seeded is skipped and never
 * fails a setup.
 *
 * Only ever a copy: an APFS clone, a reflink, or (on a filesystem with
 * neither) a plain copy of a small cache. Never a hardlink or a symlink, so
 * nothing a worktree writes can reach the main checkout, and never from a
 * place other than the main checkout.
 */

import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { gitResult, isGitError } from "../git-exec";
import { findNodeModules } from "./clone";
import { fastCopyMode } from "./fastcopy";
import { inside, realExisting } from "./paths";
import { copyTree } from "./spare";
import type { CopyMode } from "./spare";

const execFileAsync = promisify(execFile);

// Past these sizes a cache is skipped. A copy for real (no clone, no reflink)
// costs the disk; a clone of a huge one costs time, since the build then
// loads it: a main checkout's .next/cache that has grown to gigabytes built
// slower for a new worktree than starting empty (measured).
const DEFAULT_MAX_COPY_MB = 512;
const DEFAULT_MAX_CLONE_MB = 1024;

interface Stack {
  name: string;
  // Cache paths, relative to the checkout, for a project of this stack.
  paths(sourcePath: string): Promise<string[]>;
}

const hasNext = (dir: string) => {
  if (fs.readdirSync(dir).some((f) => /^next\.config\./.test(f))) return true;
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(dir, "package.json"), "utf-8")
    );
    return !!(pkg.dependencies?.next ?? pkg.devDependencies?.next);
  } catch {
    return false;
  }
};

async function nodePaths(sourcePath: string): Promise<string[]> {
  const dirs = new Set<string>();
  for (const rel of await findNodeModules(sourcePath))
    dirs.add(path.dirname(rel));
  if (fs.existsSync(path.join(sourcePath, "package.json"))) dirs.add(".");
  const out: string[] = [];
  for (const dir of dirs) {
    const abs = path.join(sourcePath, dir);
    if (!fs.existsSync(path.join(abs, "package.json"))) continue;
    out.push(path.join(dir, "*.tsbuildinfo"));
    if (hasNext(abs))
      out.push(
        path.join(dir, ".next", "cache"),
        // Next 16's dev server keeps its Turbopack cache here.
        path.join(dir, ".next", "dev", "cache")
      );
  }
  return out;
}

// One entry per stack. Add a stack here to give it defaults; a project can
// always name its own in agentos.json's `caches`.
export const STACKS: Stack[] = [
  { name: "node", paths: nodePaths },
  // iOS (DerivedData, Pods, ccache) is the agentos-mobile "Faster native iOS
  // builds" task's: it plugs in here.
  { name: "ios", paths: async () => [] },
  // Rails is deliberately absent: bootsnap's load-path cache holds absolute
  // paths, so a copy in another directory is stale on arrival.
];

export async function defaultCaches(sourcePath: string): Promise<string[]> {
  const all = await Promise.all(STACKS.map((s) => s.paths(sourcePath)));
  return all.flat();
}

// `*` is allowed in the last segment only.
async function expand(sourcePath: string, rel: string): Promise<string[]> {
  const base = path.basename(rel);
  if (!base.includes("*")) return [rel];
  const re = new RegExp(
    "^" + base.split("*").map(escapeRe).join("[^/]*") + "$"
  );
  const dir = path.dirname(rel);
  const names = await fs.promises
    .readdir(path.join(sourcePath, dir))
    .catch(() => [] as string[]);
  return names.filter((n) => re.test(n)).map((n) => path.join(dir, n));
}
const escapeRe = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

// When the worktree's HEAD was committed; null when it can't be told.
async function headTimeMs(worktreePath: string): Promise<number | null> {
  try {
    const { stdout } = await gitResult(worktreePath, [
      "log",
      "-1",
      "--format=%ct",
    ]);
    const seconds = parseInt(stdout, 10);
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  } catch {
    return null;
  }
}

// The last write to a file, or to a folder or its direct children.
async function newestMs(p: string): Promise<number> {
  const st = await fs.promises.stat(p);
  let newest = st.mtimeMs;
  if (st.isDirectory())
    for (const name of await fs.promises.readdir(p)) {
      const child = await fs.promises
        .stat(path.join(p, name))
        .catch(() => null);
      if (child) newest = Math.max(newest, child.mtimeMs);
    }
  return newest;
}

async function sizeMb(p: string): Promise<number> {
  const { stdout } = await execFileAsync("du", ["-sk", p]);
  return parseInt(stdout, 10) / 1024;
}

// Git ignores it, or seeding it would leave an uncommitted file behind.
// Outside a repository there is no answer, and it is allowed.
async function notIgnored(worktreePath: string, rel: string): Promise<boolean> {
  try {
    await gitResult(worktreePath, ["check-ignore", "-q", "--", rel]);
    return false;
  } catch (error) {
    return isGitError(error) && error.exitCode === 1;
  }
}

export interface SeedResult {
  seeded: Array<{ rel: string; how: CopyMode }>;
  skipped: Array<{ rel: string; why: string }>;
}

export async function seedBuildCaches(opts: {
  sourcePath: string;
  worktreePath: string;
  // agentos.json's `caches`; the stack defaults without it.
  paths?: string[];
  mode?: CopyMode;
  platform?: NodeJS.Platform;
  maxCopyMb?: number;
  maxCloneMb?: number;
  // Caches last written before this (ms) are stale. Default: the worktree's
  // HEAD commit time; without one every cache counts as fresh.
  freshAfterMs?: number;
}): Promise<SeedResult> {
  const { sourcePath, worktreePath } = opts;
  const result: SeedResult = { seeded: [], skipped: [] };
  // The switch for measuring a start without seeding.
  if (process.env.AGENTOS_NO_BUILD_CACHES) return result;
  const declared = opts.paths ?? (await defaultCaches(sourcePath));
  if (!declared.length) return result;

  const fast = await fastCopyMode({
    sourcePath,
    worktreePath,
    platform: opts.platform,
  });
  // Hardlinks are for dependencies from the store, never for a cache.
  const mode: CopyMode =
    opts.mode ?? (fast === "clone" || fast === "reflink" ? fast : "copy");
  const max =
    opts.maxCopyMb ??
    Number(process.env.AGENTOS_CACHE_COPY_MAX_MB || DEFAULT_MAX_COPY_MB);
  const maxClone =
    opts.maxCloneMb ??
    Number(process.env.AGENTOS_CACHE_CLONE_MAX_MB || DEFAULT_MAX_CLONE_MB);
  const freshAfter = opts.freshAfterMs ?? (await headTimeMs(worktreePath));
  const root = await fs.promises.realpath(sourcePath);
  const target = await fs.promises.realpath(worktreePath);

  const skip = (rel: string, why: string) => result.skipped.push({ rel, why });

  for (const rel of (
    await Promise.all(declared.map((d) => expand(sourcePath, d)))
  ).flat()) {
    const real = await fs.promises
      .realpath(path.join(sourcePath, rel))
      .catch(() => null);
    if (!real) continue; // not built in the main checkout yet
    if (!inside(root, real)) {
      skip(rel, "resolves outside the project");
      continue;
    }
    const dir = path.join(target, path.dirname(rel));
    if (!inside(target, await realExisting(dir))) {
      skip(rel, "its folder in the worktree resolves outside it");
      continue;
    }
    const dest = path.join(dir, path.basename(rel));
    if (await fs.promises.lstat(dest).catch(() => null)) continue; // already there
    if (await notIgnored(worktreePath, rel)) {
      skip(rel, "not ignored by git");
      continue;
    }
    if (freshAfter !== null && (await newestMs(real)) < freshAfter) {
      skip(rel, "older than the worktree's base commit");
      continue;
    }
    const limit = mode === "copy" ? max : maxClone;
    if ((await sizeMb(real).catch(() => Infinity)) > limit) {
      skip(
        rel,
        mode === "copy"
          ? `bigger than ${limit} MB and this filesystem can't clone`
          : `bigger than ${limit} MB`
      );
      continue;
    }
    await fs.promises.mkdir(dir, { recursive: true });
    if (!inside(target, await fs.promises.realpath(dir))) {
      skip(rel, "its folder in the worktree resolves outside it");
      continue;
    }
    const partial = `${dest}.aos-partial`;
    await fs.promises.rm(partial, { recursive: true, force: true });
    const ok =
      (await copyTree(real, partial, mode)) &&
      (await fs.promises.rename(partial, dest).then(
        () => true,
        () => false
      ));
    await fs.promises.rm(partial, { recursive: true, force: true });
    if (ok) result.seeded.push({ rel, how: mode });
    else skip(rel, "the copy failed");
  }
  return result;
}
