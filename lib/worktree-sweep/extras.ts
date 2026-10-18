/**
 * The second half of a run: what tasks leave beside their worktrees. Found
 * by databases.ts and caches.ts, removed here only when the full clean-up is
 * on; otherwise listed as pending, with sizes, for a dry run's report.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { SPARE_ROOT } from "../worktree-deps/spare";
import duBytes from "./du";
import { pgRun } from "../project-config/database";
import {
  declaredDatabases,
  dropTaskDatabase,
  findTaskDatabases,
  liveHashes,
  liveSessionIds,
} from "./databases";
import { findCacheLeftovers, workspaceFromPlist } from "./caches";
import type { SweepDeps } from "./runSweep";
import type {
  Candidate,
  SweepRemoved,
  SweepSkipped,
  SweepSummary,
  SweepTotals,
} from "./types";
import { WORKTREES_DIR } from "../worktrees";

export interface Extras {
  candidates: Candidate[];
  skipped: SweepSkipped[];
  drop: (c: Candidate) => Promise<boolean>;
  spares: { count: number; bytes: number };
}

const dirCount = (root: string) => {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith(".")).length;
  } catch {
    return 0;
  }
};

export async function defaultExtras(): Promise<Extras> {
  const { servers, froms } = declaredDatabases();
  const ids = liveSessionIds();
  const size = (dir: string) => duBytes(dir);
  const dbs = await findTaskDatabases({
    now: Date.now(),
    run: pgRun,
    servers,
    live: liveHashes(ids),
    froms,
  });
  const derivedRoot = path.join(
    os.homedir(),
    "Library",
    "Developer",
    "Xcode",
    "DerivedData"
  );
  const caches = await findCacheLeftovers({
    now: Date.now(),
    spareRoot: SPARE_ROOT,
    tmpRoot: os.tmpdir(),
    derivedRoot: process.platform === "darwin" ? derivedRoot : "",
    worktreesRoot: WORKTREES_DIR,
    liveIds: ids,
    workspaceOf: workspaceFromPlist,
    size,
  });
  const roots = [SPARE_ROOT, os.tmpdir(), derivedRoot];
  return {
    candidates: [...dbs.candidates, ...caches.candidates],
    skipped: [...dbs.skipped, ...caches.skipped],
    spares: { count: dirCount(SPARE_ROOT), bytes: await size(SPARE_ROOT) },
    drop: async (c) => {
      if (c.kind === "database") return dropTaskDatabase(c, froms);
      const target = path.resolve(c.path);
      if (!roots.some((r) => r && path.dirname(target) === path.resolve(r)))
        return false;
      await fs.promises.rm(target, { recursive: true, force: true });
      return !fs.existsSync(target);
    },
  };
}

// Removes (or, off or dry, only lists) what the extras found.
export async function findExtras(
  deps: SweepDeps,
  summary: SweepSummary,
  opts: { armed: boolean; dryRun: boolean }
): Promise<{ totals: SweepTotals }> {
  const x = await deps.extras();
  summary.skipped.push(...x.skipped);
  for (const c of x.candidates) {
    const item: SweepRemoved = {
      path: c.path,
      kind: c.kind,
      why: c.why ?? "",
      bytes: c.bytes ?? (await deps.size(c.path)),
    };
    if (!opts.armed) {
      summary.pending!.push(item);
      continue;
    }
    if (deps.busy()) {
      summary.skipped.push({
        path: c.path,
        kind: c.kind,
        reason: "the machine is busy; left for the next run",
      });
      continue;
    }
    if (!opts.dryRun && !(await x.drop(c).catch(() => false))) {
      summary.skipped.push({
        path: c.path,
        kind: c.kind,
        reason: "removing it failed",
      });
      continue;
    }
    summary.removed.push(item);
    summary.freedBytes += item.bytes;
  }
  const found = (kind: Candidate["kind"]) => {
    const items = [...summary.removed, ...(summary.pending ?? [])].filter(
      (i) => i.kind === kind
    );
    return {
      count: items.length,
      bytes: items.reduce((n, i) => n + i.bytes, 0),
    };
  };
  return {
    totals: {
      worktrees: {
        count: dirCount(deps.root),
        bytes: await deps.size(deps.root),
      },
      databases: found("database"),
      spares: x.spares,
      temp: found("temp"),
    },
  };
}

// For tests, and for a machine without the extras: nothing found.
export const noExtras = async (): Promise<Extras> => ({
  candidates: [],
  skipped: [],
  drop: async () => false,
  spares: { count: 0, bytes: 0 },
});
