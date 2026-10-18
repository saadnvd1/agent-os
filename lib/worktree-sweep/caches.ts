/**
 * What a task leaves outside its checkout and the database: dependency
 * spares nobody took, its temp folder, a crashed preview browser's profile,
 * and Xcode's build folder for a worktree that no longer exists. Each is
 * rebuilt or recreated on demand, so the only rule is "old enough, and not
 * in use".
 */

import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { SESSION_TMP_PREFIX, tmpName } from "../sessions/leftovers";
import { isTestTempName } from "./testTemp";
import type { Candidate, SweepSkipped } from "./types";

const DAY_MS = 24 * 3600_000;
const SPARE_MIN_AGE_MS = 7 * DAY_MS;
const BUILDING_MIN_AGE_MS = 3600_000;

export interface CacheDeps {
  now: number;
  spareRoot: string;
  tmpRoot: string;
  derivedRoot: string;
  worktreesRoot: string;
  // Ids of the sessions still running on this machine.
  liveIds: Set<string>;
  workspaceOf: (derivedDir: string) => Promise<string | null>;
  size: (dir: string) => Promise<number>;
}

export const workspaceFromPlist = (dir: string): Promise<string | null> =>
  new Promise((resolve) =>
    execFile(
      "plutil",
      [
        "-extract",
        "WorkspacePath",
        "raw",
        "-o",
        "-",
        path.join(dir, "info.plist"),
      ],
      { timeout: 10_000 },
      (error, stdout) => resolve(error ? null : String(stdout).trim() || null)
    )
  );

const subdirs = (root: string): string[] => {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(root, e.name));
  } catch {
    return [];
  }
};

const mtime = (p: string) => {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
};

const inside = (root: string, p: string) => {
  const rel = path.relative(path.resolve(root), path.resolve(p));
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
};

export async function findCacheLeftovers(deps: CacheDeps): Promise<{
  candidates: Candidate[];
  skipped: SweepSkipped[];
}> {
  const candidates: Candidate[] = [];
  const skipped: SweepSkipped[] = [];
  const add = async (dir: string, kind: Candidate["kind"], why: string) =>
    candidates.push({ path: dir, kind, why, bytes: await deps.size(dir) });

  for (const dir of subdirs(deps.spareRoot)) {
    const building = path.basename(dir).includes(".");
    const min = building ? BUILDING_MIN_AGE_MS : SPARE_MIN_AGE_MS;
    if (deps.now - mtime(dir) >= min)
      await add(
        dir,
        "spare",
        building ? "an abandoned build" : "unused for a week"
      );
  }

  const livePrefixes = [...deps.liveIds].map(tmpName);
  for (const dir of subdirs(deps.tmpRoot)) {
    const name = path.basename(dir);
    if (isTestTempName(name)) {
      if (deps.now - mtime(dir) >= DAY_MS)
        await add(dir, "test-temp", "left behind by a test run");
      continue;
    }
    const isSession = name.startsWith(SESSION_TMP_PREFIX);
    if (!isSession && !name.startsWith("agentos-preview-")) continue;
    if (deps.now - mtime(dir) < DAY_MS) continue;
    if (
      isSession &&
      livePrefixes.includes(name.slice(SESSION_TMP_PREFIX.length))
    ) {
      skipped.push({
        path: dir,
        kind: "temp",
        reason: "its session is running",
      });
      continue;
    }
    await add(
      dir,
      "temp",
      isSession ? "its task is over" : "a preview browser's profile"
    );
  }

  for (const dir of subdirs(deps.derivedRoot)) {
    const workspace = await deps.workspaceOf(dir);
    if (!workspace || !inside(deps.worktreesRoot, workspace)) continue;
    if (fs.existsSync(workspace)) continue;
    await add(dir, "derived-data", "its worktree is gone");
  }
  return { candidates, skipped };
}
