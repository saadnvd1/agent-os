/**
 * Words that must never land in this public repo: one generic term, always,
 * plus a private denylist kept outside the repo (the list itself would be a
 * mention), one case-insensitive regex per line, skipped when it's absent.
 *
 *   tsx scripts/hooks/banned-terms.ts          the staged diff's added lines (pre-commit)
 *   tsx scripts/hooks/banned-terms.ts --tree   every tracked file (scripts/check, CI)
 */

import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { scanDiff, stagedDiff, type SecretHit } from "./staged-secrets";

// Assembled so this file isn't a hit itself.
export const GENERIC_TERMS = [["compet", "itor"].join("")];

export const bannedFile = () =>
  process.env.AGENTOS_BANNED_NAMES ||
  path.join(os.homedir(), ".config", "agent-os", "banned-names");

export function loadTerms(file = bannedFile()): RegExp[] {
  const generic = GENERIC_TERMS.map((t) => new RegExp(t, "i"));
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return generic;
  }
  const own = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => new RegExp(l, "i"));
  return [...generic, ...own];
}

// What a line matched, without echoing the private pattern that caught it.
export const matcher = (terms: RegExp[]) => (line: string) => {
  for (const t of terms) {
    const m = line.match(t);
    if (m) return `"${m[0]}"`;
  }
  return null;
};

export function scanTree(cwd: string, terms: RegExp[]): SecretHit[] {
  const check = matcher(terms);
  const files = execFileSync("git", ["ls-files", "-z"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);
  const hits: SecretHit[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(cwd, file), "utf8");
    } catch {
      continue; // deleted in the working tree, or a submodule
    }
    if (text.includes("\0")) continue;
    text.split("\n").forEach((l, i) => {
      const what = check(l);
      if (what) hits.push({ file, line: i + 1, what });
    });
  }
  // A path can name something too.
  for (const file of files) {
    const what = check(file);
    if (what) hits.push({ file, line: 0, what });
  }
  return hits;
}

function stagedHits(terms: RegExp[]): SecretHit[] {
  const check = matcher(terms);
  const names = execFileSync(
    "git",
    ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"],
    { encoding: "utf8" }
  )
    .split("\0")
    .filter(Boolean)
    .flatMap((file) => {
      const what = check(file);
      return what ? [{ file, line: 0, what }] : [];
    });
  return [...scanDiff(stagedDiff(), check), ...names];
}

if (process.argv[1]?.endsWith("banned-terms.ts")) {
  const terms = loadTerms();
  const hits = process.argv.includes("--tree")
    ? scanTree(process.cwd(), terms)
    : stagedHits(terms);
  for (const h of hits)
    console.error(`✗ ${h.file}:${h.line}: names ${h.what}; reword it`);
  if (hits.length) process.exit(1);
}
