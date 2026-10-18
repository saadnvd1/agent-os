import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Folders made by tempDir, removed when the test file ends (vitest.setup.ts
// calls removeTempDirs). Kept on globalThis: vi.resetModules() would
// otherwise lose the list.
const KEY = Symbol.for("agentos.testTempDirs");
const made = (): Set<string> => {
  const g = globalThis as unknown as Record<symbol, Set<string> | undefined>;
  return (g[KEY] ??= new Set<string>());
};

/** A fresh temp folder that is removed when the test file ends. */
export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
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
