/**
 * What a task saves under .agentos/mockups and .agentos/screenshots. Git
 * ignores that folder (its .gitignore is `*`) and a Bash write isn't a
 * file-writing tool call, so neither other source lists them.
 */

import fs from "fs";
import path from "path";
import { isSecretPath } from "../secret-paths";
import { SCREENSHOT_DIR } from "../tasks/ui-brief";
import { kindForPath, type Candidate } from "./derive";

export const MOCKUP_DIR = ".agentos/mockups";
export const AGENTOS_DIRS = [MOCKUP_DIR, SCREENSHOT_DIR];
const MAX_DEPTH = 3;
const MAX_LISTED = 200;

const isAgentosFile = (rel: string) =>
  AGENTOS_DIRS.some((d) => rel.startsWith(`${d}/`));

function candidate(
  worktree: string,
  rel: string,
  at: number
): Candidate | null {
  const file = path.join(worktree, rel);
  if (isSecretPath(file)) return null;
  return {
    key: `file:${file}`,
    kind: kindForPath(file),
    name: path.basename(file),
    at,
    by: "shell",
    source: { type: "file", path: file },
  };
}

function walk(root: string, rel: string, depth: number, out: string[]): void {
  if (out.length >= MAX_LISTED) return;
  let names: fs.Dirent[];
  try {
    names = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const d of names) {
    const child = `${rel}/${d.name}`;
    // Symlinks are skipped: they could point out of the worktree.
    if (d.isFile()) out.push(child);
    else if (d.isDirectory() && depth < MAX_DEPTH)
      walk(root, child, depth + 1, out);
  }
}

export function agentosFiles(worktree: string): { rel: string; at: number }[] {
  const rels: string[] = [];
  for (const dir of AGENTOS_DIRS) walk(worktree, dir, 1, rels);
  return rels.slice(0, MAX_LISTED).flatMap((rel) => {
    try {
      return [{ rel, at: fs.statSync(path.join(worktree, rel)).mtimeMs }];
    } catch {
      return [];
    }
  });
}

export function fromAgentosDirs(
  worktree: string,
  known: Set<string>
): Candidate[] {
  return agentosFiles(worktree).flatMap(({ rel, at }) => {
    const c = candidate(worktree, rel, at);
    return c && !known.has(c.key) ? [c] : [];
  });
}

// After the worktree is gone: the copies that were kept.
export function fromKept(
  worktree: string,
  kept: string[],
  at: number,
  known: Set<string>
): Candidate[] {
  return kept.filter(isAgentosFile).flatMap((rel) => {
    const c = candidate(worktree, rel, at);
    return c && !known.has(c.key) ? [c] : [];
  });
}

// Changes when a file is added, removed or rewritten there.
export function agentosSignature(worktree: string): string {
  const files = agentosFiles(worktree);
  return `${files.length}:${files.reduce((m, f) => Math.max(m, f.at), 0)}`;
}
