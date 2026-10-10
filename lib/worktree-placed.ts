/**
 * What AgentOS put in a worktree on purpose (env copies, agentos.json's
 * `copy`, cloned dependencies), so finishing a task can tell those from
 * work an agent left uncommitted. The record lives in the worktree's own
 * git directory: outside the working tree, and gone with the worktree.
 *
 * A copied file only counts as AgentOS's while its content is still what
 * was copied; once an agent edits it, it is work like any other.
 */

import { createHash } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execFileAsync = promisify(execFile);
const MANIFEST = "agentos-placed.json";
// A copied folder bigger than this isn't recorded, so it keeps blocking.
const MAX_FILES = 2000;

export interface Placed {
  // Relative path -> sha256 of each regular file as placed.
  files: Record<string, string>;
  // Dependency folders cloned from the main checkout.
  deps: string[];
}

async function gitText(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    timeout: 30000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

const manifestPath = async (worktree: string) =>
  path.join(
    (await gitText(worktree, ["rev-parse", "--absolute-git-dir"])).trim(),
    MANIFEST
  );

async function sha(file: string): Promise<string> {
  return createHash("sha256")
    .update(await fs.promises.readFile(file))
    .digest("hex");
}

// Every regular file under `dir`, relative to `base`; null past the cap or
// on anything that isn't a plain file or folder.
async function filesUnder(
  base: string,
  dir: string,
  max = MAX_FILES
): Promise<string[] | null> {
  const out: string[] = [];
  const walk = async (rel: string): Promise<boolean> => {
    const entries = await fs.promises.readdir(path.join(base, rel), {
      withFileTypes: true,
    });
    for (const e of entries) {
      const child = path.join(rel, e.name);
      if (e.isDirectory()) {
        if (!(await walk(child))) return false;
      } else if (e.isFile()) {
        out.push(child);
        if (out.length > max) return false;
      } else return false;
    }
    return true;
  };
  return (await walk(dir).catch(() => false)) ? out : null;
}

// A path strictly inside the worktree, normalised; null for anything else.
function inside(rel: string): string | null {
  const n = path.normalize(rel).replace(/[/\\]+$/, "");
  if (!n || n === "." || path.isAbsolute(n) || n.split(path.sep)[0] === "..")
    return null;
  return n;
}

/**
 * Records what setup placed. `copied` are files or folders, `deps` cloned
 * dependency folders, all relative to the worktree. Adds to an earlier
 * record rather than replacing it.
 */
export async function recordPlaced(
  worktree: string,
  copied: string[],
  deps: string[]
): Promise<void> {
  const placed = await readPlaced(worktree);
  for (const rel of copied.map(inside).filter((r) => r !== null)) {
    const st = await fs.promises
      .lstat(path.join(worktree, rel))
      .catch(() => null);
    if (st?.isFile()) placed.files[rel] = await sha(path.join(worktree, rel));
    else if (st?.isDirectory()) {
      const files = await filesUnder(worktree, rel);
      for (const f of files ?? [])
        placed.files[f] = await sha(path.join(worktree, f));
    }
  }
  const cloned = deps.map(inside).filter((r) => r !== null);
  placed.deps = [...new Set([...placed.deps, ...cloned])];
  await fs.promises.writeFile(
    await manifestPath(worktree),
    JSON.stringify(placed)
  );
}

export async function readPlaced(worktree: string): Promise<Placed> {
  try {
    const got = JSON.parse(
      await fs.promises.readFile(await manifestPath(worktree), "utf-8")
    );
    return {
      files: got && typeof got.files === "object" ? got.files : {},
      deps: Array.isArray(got?.deps) ? got.deps : [],
    };
  } catch {
    return { files: {}, deps: [] };
  }
}

// `git status --porcelain -z`: [status, path] pairs, renames by new path.
export function parsePorcelain(out: string): Array<[string, string]> {
  const parts = out.split("\0");
  const entries: Array<[string, string]> = [];
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (rec.length < 4) continue;
    const xy = rec.slice(0, 2);
    entries.push([xy, rec.slice(3)]);
    // A rename or copy is followed by its old path.
    if (xy[0] === "R" || xy[0] === "C") i++;
  }
  return entries;
}

async function unchanged(
  worktree: string,
  rel: string,
  placed: Placed
): Promise<boolean> {
  const want = placed.files[rel];
  if (!want) return false;
  const file = path.join(worktree, rel);
  const st = await fs.promises.lstat(file).catch(() => null);
  return !!st?.isFile() && (await sha(file)) === want;
}

// Whether one status entry is only what AgentOS placed, untouched.
async function isPlaced(
  worktree: string,
  xy: string,
  entry: string,
  placed: Placed
): Promise<boolean> {
  const rel = entry.replace(/\/$/, "");
  if (xy === "??" && placed.deps.includes(rel)) {
    const st = await fs.promises
      .lstat(path.join(worktree, rel))
      .catch(() => null);
    return !!st?.isDirectory();
  }
  if (xy === " M") return unchanged(worktree, rel, placed);
  if (xy !== "??") return false;
  if (!entry.endsWith("/")) return unchanged(worktree, rel, placed);
  // An untracked folder: every file in it must be one that was placed.
  const files = await filesUnder(worktree, rel);
  if (!files) return false;
  for (const f of files)
    if (!(await unchanged(worktree, f, placed))) return false;
  return true;
}

/**
 * What in the worktree would be lost by removing it: every uncommitted
 * change except what AgentOS placed and nobody has touched since.
 * Gitignored files aren't listed, as git doesn't list them.
 */
export async function unsavedChanges(worktree: string): Promise<string[]> {
  const out = await gitText(worktree, ["status", "--porcelain", "-z"]);
  const entries = parsePorcelain(out);
  if (!entries.length) return [];
  const placed = await readPlaced(worktree);
  const left: string[] = [];
  for (const [xy, entry] of entries)
    if (!(await isPlaced(worktree, xy, entry, placed))) left.push(entry);
  return left;
}

// "3 files: a, b, c", naming at most `max` of them.
export function describeChanges(paths: string[], max = 5): string {
  const named = paths.slice(0, max).join(", ");
  const more = paths.length > max ? `, and ${paths.length - max} more` : "";
  return `${paths.length} file${paths.length === 1 ? "" : "s"}: ${named}${more}`;
}
