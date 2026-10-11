/**
 * The pre-commit secret scan: the staged diff's added lines, read with the
 * merge gate's own rule (lib/orchestrator/diff.ts secretsIn), so a commit
 * that would fail the gate fails here first, naming the file and line.
 */

import { execFileSync } from "child_process";
import { secretsIn } from "../../lib/orchestrator/diff";

export interface SecretHit {
  file: string;
  line: number;
  what: string;
}

// Each added line of a `git diff -U0` that `check` flags, with the file and
// new line number it lands on. Headers are only read before a file's first
// hunk, so an added line that itself starts with "++" isn't taken for one.
export function scanDiff(
  diff: string,
  check: (line: string) => string | null = secretsIn
): SecretHit[] {
  const hits: SecretHit[] = [];
  let file = "";
  let line = 0;
  let header = false;
  for (const l of diff.split("\n")) {
    if (l.startsWith("diff --git ")) {
      header = true;
    } else if (header && l.startsWith("+++ ")) {
      file = l.slice(4).replace(/^b\//, "");
    } else if (l.startsWith("@@")) {
      header = false;
      line = Number(l.match(/\+(\d+)/)?.[1] ?? 0);
    } else if (!header && l.startsWith("+")) {
      const what = check(l.slice(1));
      if (what) hits.push({ file, line, what });
      line++;
    }
  }
  return hits;
}

export const stagedDiff = () =>
  execFileSync(
    "git",
    [
      "diff",
      "--cached",
      "-U0",
      "--no-color",
      "--no-ext-diff",
      "--diff-filter=ACMR",
    ],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }
  );

if (process.argv[1]?.endsWith("staged-secrets.ts")) {
  const hits = scanDiff(stagedDiff());
  for (const h of hits)
    console.error(`✗ ${h.file}:${h.line}: looks like a secret (${h.what})`);
  if (hits.length) {
    console.error(
      "The merge gate refuses token-shaped strings. For a test fixture, build the fake at runtime\n" +
        '(e.g. "gh" + "p_" + "a".repeat(36)) instead of writing it as a literal.'
    );
    process.exit(1);
  }
}
