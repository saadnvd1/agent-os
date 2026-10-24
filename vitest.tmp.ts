import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import {
  LEGACY_TEST_TEMP_PREFIXES,
  RUN_PREFIX,
} from "./lib/worktree-sweep/testTemp";

// Where the suite's temp dirs live. Kept short: a Unix socket path is capped
// at 104 bytes on macOS and its $TMPDIR is already about 50 of them.
export { RUN_PREFIX };
export const FILE_PREFIX = "f-";

// Where the run root goes. A socket made under it (a tmux server's, Chrome's
// own `com.google.Chrome.XXXXXX/SingletonSocket`) must fit sun_path's 104
// bytes on macOS, and an AgentOS session's $TMPDIR is already about 95 of
// them, so a long one is passed over for /tmp.
const MAX_REAL_TMPDIR = 24;
export function runRootBase(
  real: string,
  platform: NodeJS.Platform = process.platform
): string {
  return platform !== "win32" && real.length > MAX_REAL_TMPDIR ? "/tmp" : real;
}

export const LEGACY_PREFIXES = LEGACY_TEST_TEMP_PREFIXES;

const DAY_MS = 24 * 60 * 60 * 1000;

const matches = (name: string, prefixes: readonly string[]) =>
  prefixes.some((p) => name.startsWith(p));

/**
 * Removes the suite's own entries in `dir` last touched over `maxAgeMs` ago,
 * at most `limit` of them: a big backlog drains over several runs instead of
 * holding one up.
 */
export function sweepStale(
  dir: string,
  { now = Date.now(), maxAgeMs = DAY_MS, limit = 2000 } = {}
): { removed: number; failed: number } {
  let removed = 0;
  let failed = 0;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return { removed, failed };
  }
  for (const name of names) {
    if (removed + failed >= limit) break;
    if (!matches(name, [RUN_PREFIX, ...LEGACY_PREFIXES])) continue;
    try {
      const path = join(dir, name);
      if (now - lstatSync(path).mtimeMs <= maxAgeMs) continue;
      rmSync(path, { recursive: true, force: true });
      removed++;
    } catch {
      failed++;
    }
  }
  return { removed, failed };
}

/** Every temp-dir prefix the suite's sources create, for the leak guard. */
export function testTmpPrefixes(repoRoot: string): string[] {
  const found = new Set<string>([RUN_PREFIX, ...LEGACY_PREFIXES]);
  let files: string[] = [];
  try {
    files = execFileSync("git", ["ls-files"], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
      .split("\n")
      .filter((f) =>
        /(\.test\.tsx?|\.test-helpers\.ts|(^|\/)testing\.ts|^vitest\.setup\.ts)$/.test(
          f
        )
      );
  } catch {
    // not a git checkout: the known list still guards the big ones
  }
  const re = /tmpdir\(\)\s*,\s*["'`]([\w.-]{4,})/g;
  for (const f of files) {
    let src: string;
    try {
      src = readFileSync(join(repoRoot, f), "utf8");
    } catch {
      continue;
    }
    for (const m of src.matchAll(re)) found.add(m[1]);
  }
  return [...found];
}

export function snapshot(
  dir: string,
  prefixes: readonly string[]
): Set<string> {
  try {
    return new Set(readdirSync(dir).filter((n) => matches(n, prefixes)));
  } catch {
    return new Set();
  }
}

/** Matching entries in `dir` that were not there in `before`. */
export function leaks(
  dir: string,
  prefixes: readonly string[],
  before: ReadonlySet<string>
): string[] {
  return [...snapshot(dir, prefixes)].filter((n) => !before.has(n)).sort();
}

export const rmTree = (path: string) =>
  rmSync(path, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });

export const exists = (path: string) => existsSync(path);

declare module "vitest" {
  export interface ProvidedContext {
    tmpRoot: string;
  }
}

/**
 * Folders in `dir` (a worktrees folder) that weren't there in `before` and
 * whose `.git` file points into this run's temp root: a test's throwaway
 * repository whose worktree landed in the real home. A live task's new
 * worktree points at its own repository, so it never matches.
 */
export function worktreeLeaks(
  dir: string,
  before: ReadonlySet<string>,
  tmpRoots: readonly string[]
): string[] {
  const out: string[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (before.has(name)) continue;
    try {
      const m = /^gitdir:\s*(.+)$/m.exec(
        readFileSync(join(dir, name, ".git"), "utf8")
      );
      if (m && tmpRoots.some((r) => m[1].trim().startsWith(r))) out.push(name);
    } catch {
      // Not a worktree: not a test's.
    }
  }
  return out.sort();
}
