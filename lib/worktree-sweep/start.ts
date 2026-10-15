import fs from "fs";
import path from "path";
import { dbPath } from "../db/path";
import { WORKTREES_DIR } from "../worktrees";
import { sweep } from "./runSweep";

export const SWEEP_EVERY_MS = 6 * 3600_000;
export const SWEEP_FIRST_AFTER_MS = 10 * 60_000;

const OWNER_FILE = ".sweep-owner";

// A development or test instance has its own database but sees the real
// worktrees folder: every live worktree would look like an orphan to it. Only
// a production server, or one asked to, sweeps, and only a folder it owns.
export const sweepEnabled = (env: NodeJS.ProcessEnv = process.env) =>
  !env.VITEST &&
  (env.AGENTOS_WORKTREE_SWEEP === "1" ||
    (env.NODE_ENV === "production" && env.AGENTOS_WORKTREE_SWEEP !== "0"));

// First sweep claims the folder for this database; another one's claim stands.
export function ownsWorktrees(
  claim: boolean,
  root = WORKTREES_DIR,
  db = path.resolve(dbPath())
): boolean {
  const file = path.join(root, OWNER_FILE);
  try {
    return fs.readFileSync(file, "utf8").trim() === db;
  } catch {
    // unclaimed
  }
  if (!claim) return false;
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(file, db);
  return true;
}

const g = globalThis as unknown as { __agentosSweeping?: boolean };

// One run at a time, however it was asked for.
export async function sweepNow(dryRun = false) {
  if (g.__agentosSweeping) throw new Error("A clean-up is already running");
  if (!ownsWorktrees(sweepEnabled()))
    throw new Error("Another AgentOS owns the worktrees folder");
  g.__agentosSweeping = true;
  try {
    return await sweep({ dryRun });
  } finally {
    g.__agentosSweeping = false;
  }
}

export function startWorktreeSweep(): void {
  if (!sweepEnabled()) return;
  const run = () => {
    sweepNow().catch((error) =>
      console.error("[worktree-sweep] not run:", error.message)
    );
  };
  setTimeout(() => {
    run();
    setInterval(run, SWEEP_EVERY_MS);
  }, SWEEP_FIRST_AFTER_MS);
}
