/**
 * What a task leaves outside its checkout, released when it ends (merge,
 * drop, done, move, delete): its dev server, its private database and what
 * the project derived from it, and its temp folder. The worktree itself is
 * removed by the caller, which knows whether anything in it would be lost.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { stopDevServer } from "../dev-instance/stopDevServer";
import { dropSessionDatabase } from "../project-config/database";

export const SESSION_TMP_PREFIX = "agentos-s-";

export const sessionTmpDir = (sessionId: string) =>
  path.join(
    os.tmpdir(),
    `${SESSION_TMP_PREFIX}${sessionId.replace(/[^\w-]/g, "").slice(0, 8)}`
  );

export interface LeftoverDeps {
  stopDev: (worktree: string) => Promise<unknown>;
  dropDatabase: (sessionId: string) => Promise<void>;
  removeDir: (dir: string) => Promise<void>;
}

const realDeps: LeftoverDeps = {
  stopDev: (worktree) => stopDevServer(worktree),
  dropDatabase: dropSessionDatabase,
  removeDir: (dir) => fs.promises.rm(dir, { recursive: true, force: true }),
};

/**
 * Never throws and never waits on a step that can't be reached: each is
 * tried on its own. Callers read the session row first and don't await this.
 */
export async function releaseSessionLeftovers(
  session: { id: string; worktree_path?: string | null },
  deps: Partial<LeftoverDeps> = {}
): Promise<void> {
  const d = { ...realDeps, ...deps };
  const steps: Array<[string, () => Promise<unknown>]> = [
    // First: its row is read before the caller deletes it.
    ["database", () => d.dropDatabase(session.id)],
    [
      "dev server",
      async () => {
        if (session.worktree_path) await d.stopDev(session.worktree_path);
      },
    ],
    ["temp folder", () => d.removeDir(sessionTmpDir(session.id))],
  ];
  for (const [what, step] of steps) {
    try {
      await step();
    } catch (error) {
      console.error(`[leftovers] ${what} for ${session.id}:`, error);
    }
  }
}
