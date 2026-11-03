import { gitSync } from "@/lib/git-exec";
import type { Change } from "./types";

const git = (cwd: string, args: string[]) =>
  gitSync(cwd, args, { maxBuffer: 64 * 1024 * 1024 });

// Where this branch left the base: origin/main, else main.
export function mergeBase(cwd: string): string | null {
  for (const ref of ["origin/main", "main"]) {
    try {
      return git(cwd, ["merge-base", "HEAD", ref]).trim();
    } catch {
      continue;
    }
  }
  return null;
}

export function parseNameStatus(out: string): Change[] {
  const changes: Change[] = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    const [status, a, b] = line.split("\t");
    if (status.startsWith("R") || status.startsWith("C"))
      changes.push({ path: b, from: a, deleted: false });
    else changes.push({ path: a, deleted: status === "D" });
  }
  return changes;
}

// Everything this branch changed against its base: commits, staged and
// unstaged edits, and files not added yet.
export function changedFiles(cwd: string, base: string): Change[] {
  const changes = parseNameStatus(
    git(cwd, ["diff", "--name-status", "-M", base])
  );
  const seen = new Set(changes.map((c) => c.path));
  for (const path of git(cwd, ["ls-files", "--others", "--exclude-standard"])
    .split("\n")
    .filter(Boolean))
    if (!seen.has(path)) changes.push({ path, deleted: false });
  return changes;
}

export const trackedFiles = (cwd: string): string[] =>
  git(cwd, ["ls-files"]).split("\n").filter(Boolean);
