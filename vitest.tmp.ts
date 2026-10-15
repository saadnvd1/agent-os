import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";

// Where the suite's temp dirs live. Kept short: a Unix socket path is capped
// at 104 bytes on macOS and its $TMPDIR is already about 50 of them.
export const RUN_PREFIX = "aos-t-";
export const FILE_PREFIX = "f-";

// Names only the test suite creates, left behind by runs from before every
// test got its own root. The sweep may remove these. Names that server code
// also creates (agentos-db-, agentos-img-...) are not here: a live server
// could own them.
export const LEGACY_PREFIXES = [
  "agent-os-test-",
  "agent-os-home-",
  "agent-os-limits-",
  "agent-os-git-",
  "agent-os-session-logs-",
  "agent-os-kept-",
  "aos-done-repo-",
  "aos-orch-repo-",
  "aos-armed-repo-",
  "aos-orch-ext-repo-",
  "aos-orch-external-",
  "aos-quick-repo-",
  "aos-config-",
  "agentos-link-",
];

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
