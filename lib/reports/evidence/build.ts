// Evidence items from what was read. Pure: the collectors in gather.ts do the
// reading, so these are tested with fixtures.

import type { TaskCheck, TaskReviewVerdict } from "../../tasks/loop-types";
import type { TaskState } from "../../tasks/state";
import type { DigestSignals } from "../../analyst/types";
import { latestChecks } from "../../analyst/signals";
import type { EvidenceRef } from "../types";
import { sessionPath } from "../../session-url";

const EXCERPT = 1500;
const cap = (s: string, n = EXCERPT) =>
  s.length > n ? `${s.slice(0, n)}…` : s;

export function ciEvidence(
  checks: TaskCheck[],
  head: string | null,
  at: string
): EvidenceRef[] {
  return checks
    .filter((c) => c.state !== "skipped" && c.state !== "neutral")
    .slice(0, 30)
    .map((c) => ({
      id: `ci:${c.name}`,
      kind: "ci",
      label: `CI · ${c.name}`,
      status:
        c.state === "pass"
          ? "pass"
          : c.state === "pending"
            ? "pending"
            : "fail",
      at: c.completedAt ?? at,
      sha: head ?? undefined,
      url: c.url ?? undefined,
      excerpt: c.log
        ? cap(`${c.log.step ?? ""}\n${c.log.tail}`.trim())
        : undefined,
    }));
}

export function reviewEvidence(
  review: TaskReviewVerdict | null
): EvidenceRef[] {
  if (!review) return [];
  const findings = review.findings
    .map(
      (f) =>
        `[${f.severity}] ${f.file ?? ""}${f.line ? `:${f.line}` : ""} ${f.summary}`
    )
    .join("\n");
  return [
    {
      id: `review:${review.sha.slice(0, 7)}`,
      kind: "review",
      label: "Independent review",
      status:
        review.status === "pass"
          ? "pass"
          : review.status === "running"
            ? "pending"
            : "fail",
      at: review.at,
      sha: review.sha,
      excerpt: cap(`${review.summary}\n${findings}`.trim()),
    },
  ];
}

// The last run of each test, build, typecheck or lint command.
export function testEvidence(
  signals: DigestSignals,
  sessionId: string,
  head: string | null,
  at: string
): EvidenceRef[] {
  return latestChecks(signals)
    .slice(0, 12)
    .map((c, i) => ({
      id: `test:${i + 1}`,
      kind: "test",
      label: c.command.slice(0, 120),
      status: c.passed ? "pass" : "fail",
      at,
      sha: head ?? undefined,
      href: sessionPath({ id: sessionId }),
    }));
}

export function diffEvidence(
  numstat: string,
  sessionId: string,
  at: string
): EvidenceRef[] {
  const out: EvidenceRef[] = [];
  for (const line of numstat.split("\n")) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (!m) continue;
    out.push({
      id: `diff:${m[3]}`,
      kind: "diff",
      label: `${m[3]} (+${m[1] === "-" ? 0 : m[1]} −${m[2] === "-" ? 0 : m[2]})`,
      status: "info",
      at,
      href: sessionPath({ id: sessionId }),
    });
    if (out.length >= 40) break;
  }
  return out;
}

export function stateEvidence(
  state: TaskState,
  blocked: string | null,
  at: string
): EvidenceRef {
  return {
    id: "state:task",
    kind: "state",
    label: `Task state: ${state}`,
    status: state === "checks-failing" || state === "blocked" ? "fail" : "info",
    at,
    excerpt: blocked ? cap(blocked) : undefined,
  };
}

export function askEvidence(
  asks: { id: number; title: string; detail: string; created_at: string }[]
): EvidenceRef[] {
  return asks.slice(0, 5).map((a) => ({
    id: `ask:${a.id}`,
    kind: "ask",
    label: `Waiting on you: ${a.title}`,
    status: "pending",
    at: a.created_at,
    excerpt: cap(a.detail),
  }));
}

export function acceptEvidence(
  items: { label: string; met: boolean; note?: string }[],
  at: string
): EvidenceRef[] {
  return items.map((it, i) => ({
    id: `accept:${i + 1}`,
    kind: "accept",
    label: it.label,
    status: it.met ? "pass" : "pending",
    at,
    excerpt: it.note ? cap(it.note) : undefined,
  }));
}

export function logEvidence(log: {
  sessionId: string;
  mergeCommit: string | null;
  prNumber: number | null;
  durationMs: number | null;
  costUsd: number;
  createdAt: string;
}): EvidenceRef {
  const mins =
    log.durationMs !== null
      ? Math.max(1, Math.round(log.durationMs / 60000))
      : null;
  return {
    id: "log:task",
    kind: "log",
    label: [
      log.prNumber ? `Merged as pull request ${log.prNumber}` : "Task log",
      mins ? `in ${mins} min` : "",
    ]
      .filter(Boolean)
      .join(" "),
    status: "pass",
    at: log.createdAt,
    excerpt: log.mergeCommit ? `Merge commit ${log.mergeCommit}` : undefined,
    href: sessionPath({ id: log.sessionId }),
  };
}

// FNV-1a over ids and statuses: times and excerpts don't change it.
export function evidenceHash(evidence: EvidenceRef[], head: string | null) {
  let h = 2166136261;
  const s = `${head ?? ""}|${evidence
    .map((e) => `${e.id}:${e.status}`)
    .sort()
    .join(",")}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
