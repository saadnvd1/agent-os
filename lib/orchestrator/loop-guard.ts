/**
 * The loop guard: when a task's PR goes to Saad because it's stuck, not
 * because a gate failed twice. Every new head is judged afresh (CI, a new
 * independent review, scope...) and an armed task merges by itself once a
 * head passes them all. It's stuck when the same gate has failed on
 * LOOP_GUARD_COMMITS commits in a row, or failed the same way on two
 * consecutive commits: an unchanged signature, worked out here without a
 * model (the failing CI job and its failing tests or first error; the
 * review's blocking findings by file and line).
 */

import { failedJobLog, repoOfPR } from "../tasks/pr-activity";
import { lastFailures, type CommitFailure, type FailureRow } from "./gates";

export const LOOP_GUARD_COMMITS = 4;

export type StuckBy = "streak" | "repeat";

export function stuckBy(row: FailureRow): StuckBy | null {
  if (row.repeated) return "repeat";
  if (row.streak >= LOOP_GUARD_COMMITS) return "streak";
  return null;
}

const short = (sha: string) => sha.slice(0, 7);
const REASON_MAX = 400;

// What Saad's ask says: which condition fired, and the failures.
export function stuckWhy(sessionId: string, row: FailureRow, by: StuckBy) {
  const failures = lastFailures(
    sessionId,
    row.gate,
    by === "repeat" ? 2 : Math.max(row.streak, 1)
  );
  const head =
    by === "repeat"
      ? `the ${row.gate} gate failed the same way on two commits in a row (${row.last_signature})`
      : `the ${row.gate} gate failed on ${row.streak} commits in a row (the loop guard stops at ${LOOP_GUARD_COMMITS})`;
  return [head, ...failures.map(failureLine)].join("\n");
}

const failureLine = (f: CommitFailure) => {
  const reason = (f.reason ?? "").replace(/\s+/g, " ").trim();
  return `- ${short(f.sha)}: ${reason.length > REASON_MAX ? `${reason.slice(0, REASON_MAX)}…` : reason}`;
};

// Commit ids and timings change between runs of the same failure.
const HEX = /\b[0-9a-f]{7,40}\b/gi;
const TIMING = /\s*[([]?\s*\d+(\.\d+)?\s?(ms|s)\s*[)\]]?/g;
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

export const normalize = (text: string) =>
  text
    .replace(/<\/?untrusted(?:\s+source="[^"]*")?>/g, "")
    .replace(ANSI, "")
    .replace(HEX, "<sha>")
    .replace(TIMING, "")
    .replace(/\s+/g, " ")
    .trim();

const SIG_MAX = 500;
const cap = (s: string) => (s.length > SIG_MAX ? s.slice(0, SIG_MAX) : s);

// `gh run view --log-failed` lines are "job<TAB>step<TAB>time text".
const logText = (line: string) => {
  const parts = line.split("\t");
  return (parts.length >= 3 ? parts.slice(2).join("\t") : line)
    .replace(ANSI, "")
    .replace(/^﻿?\d{4}-\d\d-\d\dT[\d:.]+Z ?/, "");
};

// A test runner's failed tests: vitest/jest "FAIL file > name" and the
// "×"/"✗" marks, node's "not ok".
const FAILED_TEST = /^\s*(?:FAIL\s+|[×✗]\s+|not ok \d+ - )(.+)$/;
const ERROR_LINE =
  /##\[error\]|\berror\b|\bfail(ed|ure|s)?\b|AssertionError|panic:/i;
const RUNNER_EXIT = /Process completed with exit code/;

// A failure's log (CI, or a local test run): the job or command, then its
// failing tests, or its first error line.
// Null when there's nothing to tell one failure from another.
export function failureSignature(
  check: string | null | undefined,
  log: string | null
): string | null {
  if (!check || !log) return null;
  const lines = log.split("\n").map(logText);
  const tests = [
    ...new Set(
      lines
        .map((l) => FAILED_TEST.exec(l)?.[1])
        .filter((t): t is string => !!t)
        .map(normalize)
        .filter(Boolean)
    ),
  ].sort();
  if (tests.length) return cap(`${check}: ${tests.join("; ")}`);
  const error = lines.find(
    (l) => ERROR_LINE.test(l) && !RUNNER_EXIT.test(l) && normalize(l)
  );
  return error ? cap(`${check}: ${normalize(error)}`) : null;
}

export const ciSignature = failureSignature;

// A review's blocking findings, by where they are: the reviewer words the
// same finding differently each time, but not its file and line. A finding
// with no place is known by the start of its summary.
export function reviewSignature(detail: string | null): string | null {
  if (!detail) return null;
  const found = detail
    .split("\n")
    .map((l) => /^- \[blocking\]\s*([^:\s]*(?::\d+)?)?\s*:\s*(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) =>
      m[1]
        ? m[1]
        : normalize(m[2]).toLowerCase().split(" ").slice(0, 8).join(" ")
    )
    .filter(Boolean);
  return found.length ? cap([...new Set(found)].sort().join(", ")) : null;
}

// Any other gate: its reason, without the commit it names.
export const reasonSignature = (reason: string | null | undefined) =>
  reason ? cap(normalize(reason)) || null : null;

export interface CiFailure {
  repo: string;
  prUrl: string;
  failing: string | null | undefined;
  failingUrl: string | null | undefined;
}

// Reads the failing job's log (one gh call). A log that can't be read is no
// signature, never a guess.
export async function readCiSignature(f: CiFailure): Promise<string | null> {
  const repo = repoOfPR(f.prUrl);
  if (!f.failing || !repo) return null;
  try {
    return ciSignature(
      f.failing,
      await failedJobLog(f.repo, repo, f.failingUrl)
    );
  } catch {
    return null;
  }
}
