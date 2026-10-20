import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { RUN_PREFIX } from "@/lib/worktree-sweep/testTemp";

// Folders made by tempDir, removed when the test file ends (vitest.setup.ts
// calls removeTempDirs). Kept on globalThis: vi.resetModules() would
// otherwise lose the list.
const KEY = Symbol.for("agentos.testTempDirs");
const ROOT_KEY = Symbol.for("agentos.testTempRoot");
const made = (): Set<string> => {
  const g = globalThis as unknown as Record<symbol, Set<string> | undefined>;
  return (g[KEY] ??= new Set<string>());
};

// The sweep recognises a test's leftovers by the RUN_PREFIX folder above
// them. The suite's TMPDIR is already inside one; outside it (a script
// importing this) the folder is made here, so every tempDir is under one.
function base(): string {
  const root = tmpdir();
  if (root.split(sep).some((s) => s.startsWith(RUN_PREFIX))) return root;
  const g = globalThis as unknown as Record<symbol, string | undefined>;
  if (!g[ROOT_KEY] || !existsSync(g[ROOT_KEY])) {
    g[ROOT_KEY] = mkdtempSync(join(root, RUN_PREFIX));
    made().add(g[ROOT_KEY]);
  }
  return g[ROOT_KEY];
}

/** A fresh temp folder that is removed when the test file ends. */
export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(base(), prefix));
  made().add(dir);
  return dir;
}

export function removeTempDirs(): void {
  for (const dir of made()) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      // the run root's removal is the backstop
    }
  }
  made().clear();
}
