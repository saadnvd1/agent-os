/**
 * Which files the Artifacts view may open: inside the session's own folders
 * or the few AgentOS folders agents write output to, never a secret, judged
 * on the real path so a link can't lead out. Stricter than the file browser.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { artifactsDir } from "../artifacts/store";
import { auditsRoot } from "../session-audit/store";
import { WORKTREES_DIR } from "../worktrees";
import { isSecretPath } from "../secret-paths";
import { keptDir } from "./keep";

export interface RootsFor {
  worktree_path?: string | null;
  working_directory?: string | null;
  projectPath?: string | null;
}

const expand = (p: string) =>
  p === "~" || p.startsWith("~/") ? os.homedir() + p.slice(1) : p;

// A folder and, when it differs, its real path (/tmp is /private/tmp).
function withReal(dirs: string[]): string[] {
  const out = new Set<string>();
  for (const d of dirs) {
    const abs = path.resolve(expand(d));
    out.add(abs);
    try {
      out.add(fs.realpathSync(abs));
    } catch {
      // Not there (a removed worktree): its literal path still counts.
    }
  }
  return [...out];
}

export function allowedRoots(s: RootsFor): string[] {
  const dirs = [
    s.worktree_path,
    s.working_directory,
    s.projectPath,
    artifactsDir(),
    keptDir(),
    auditsRoot(),
    WORKTREES_DIR,
    os.tmpdir(),
    "/tmp",
  ].filter((d): d is string => !!d);
  // A session started in ~ (or /) would otherwise open everything.
  const home = path.resolve(os.homedir());
  return withReal(dirs).filter((d) => d !== path.parse(d).root && d !== home);
}

export const within = (file: string, roots: string[]) =>
  roots.some((r) => file === r || file.startsWith(r + path.sep));

// The real file to serve, or why not. Regular files only.
export function resolveAllowed(
  file: string,
  roots: string[]
): { ok: true; real: string; size: number } | { ok: false; status: 403 | 404 } {
  if (isSecretPath(file)) return { ok: false, status: 403 };
  let real: string;
  try {
    real = fs.realpathSync(file);
  } catch {
    return { ok: false, status: 404 };
  }
  if (isSecretPath(real) || !within(real, roots))
    return { ok: false, status: 403 };
  try {
    const stat = fs.statSync(real);
    if (!stat.isFile()) return { ok: false, status: 404 };
    return { ok: true, real, size: stat.size };
  } catch {
    return { ok: false, status: 404 };
  }
}
