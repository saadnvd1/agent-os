/**
 * Everything a merged task's log says, read from what AgentOS already
 * stores: the session row, the brief and its amendments, the independent
 * review and CI records, the asks raised about it, the usage ledger and the
 * task agent's last message. Nothing here is computed again or sent to a
 * model.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { db, type Session } from "../db";
import { itemsOfKind } from "../chat/store";
import { effectiveModels } from "../models/config";
import { ANTHROPIC } from "../models/roles";
import { getProject } from "../projects";
import { getWorkspace } from "../workspaces";
import { amendmentsOf } from "../orchestrator/amendments";
import { PLAN_FILE } from "../models/plan-step";
import { estimateCost, rowModel } from "../usage/cost";
import { sessionPath } from "../session-url";
import type { LogData, LogEvent, LogUsageRow } from "./build";
import { ownerUi } from "../owner";

const expandHome = (p: string) => p.replace(/^~/, os.homedir());

// The task's plan file, read while its worktree still exists. null: none.
const MAX_PLAN_BYTES = 256 * 1024;
export function readPlanFile(worktreePath: string | null): string | null {
  if (!worktreePath) return null;
  try {
    const file = path.join(expandHome(worktreePath), PLAN_FILE);
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_PLAN_BYTES) return null;
    const text = fs.readFileSync(file, "utf8");
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

interface CheckRow {
  sha: string;
  kind: string;
  status: string;
  detail: string | null;
  created_at: string;
}

const REVIEW_WORD: Record<string, string> = {
  pass: "Review passed",
  block: "Review blocked the merge",
  error: "Review could not run",
  running: "Review started",
};
const SCOPE_WORD: Record<string, string> = {
  pass: "Scope check passed",
  block: "Scope check blocked the merge",
  error: "Scope check could not run",
  running: "Scope check started",
};

function checkEvents(id: string, merged: string | null): LogEvent[] {
  const rows = db
    .prepare(
      `SELECT sha, kind, status, detail, created_at FROM orchestrator_checks
       WHERE session_id = ? ORDER BY created_at, id`
    )
    .all(id) as CheckRow[];
  return rows.flatMap((c): LogEvent[] => {
    if (c.kind === "ci")
      // The settle record exists for every head that had checks; only the
      // head that merged is known to have been green.
      return c.sha === merged
        ? [{ at: c.created_at, text: "CI green", sha: c.sha }]
        : [];
    const word = (c.kind === "review" ? REVIEW_WORD : SCOPE_WORD)[c.status];
    if (!word) return [];
    return [
      {
        at: c.created_at,
        text: word,
        sha: c.sha,
        detail: c.status === "running" ? null : c.detail,
      },
    ];
  });
}

const GATE_WORD: Record<string, string> = {
  ci: "CI failed",
  review: "Review gate failed",
  "code-review": "Code-review gate failed",
  scope: "Scope gate failed",
  blocked: "Blocked gate failed",
  stack: "Stack gate failed",
};

// The failure text names its failing check inside an untrusted fence;
// the fence tags carry no information here.
const unfence = (s: string) => s.replace(/<\/?untrusted[^>]*>/g, "");

function failureEvents(id: string): LogEvent[] {
  const rows = db
    .prepare(
      `SELECT gate, sha, reason, created_at FROM orchestrator_gate_failure_commits
       WHERE session_id = ? ORDER BY created_at`
    )
    .all(id) as {
    gate: string;
    sha: string;
    reason: string | null;
    created_at: string;
  }[];
  return rows.map((r) => {
    const conflict = /conflict/i.test(r.reason ?? "");
    const failing =
      r.gate === "ci" ? /\(([^)]+)\)\s*$/.exec(unfence(r.reason ?? "")) : null;
    return {
      at: r.created_at,
      text: conflict
        ? "Merge conflict held the gates"
        : (GATE_WORD[r.gate] ?? `Gate ${r.gate} failed`),
      sha: r.sha,
      quote: failing ? `failing check: ${failing[1]}` : null,
      detail: failing || !r.reason ? null : unfence(r.reason),
    };
  });
}

function askEvents(id: string): LogEvent[] {
  const rows = db
    .prepare(
      `SELECT kind, title, detail, status, answer, created_at, resolved_at, sha
       FROM orchestrator_asks WHERE subject = ? ORDER BY id`
    )
    .all(`task:${id}`) as {
    kind: string;
    title: string;
    detail: string;
    status: string;
    answer: string | null;
    created_at: string;
    resolved_at: string | null;
    sha: string | null;
  }[];
  return rows.flatMap((a): LogEvent[] => {
    const raised: LogEvent = {
      at: a.created_at,
      text: `Escalated to ${ownerUi()} (${a.kind})`,
      sha: a.sha,
      quote: a.title,
      detail: a.detail || null,
    };
    if (!a.resolved_at) return [raised];
    return [
      raised,
      {
        at: a.resolved_at,
        text: `${ownerUi(true)} ${a.status === "approved" ? "approved" : a.status === "declined" ? "declined" : "answered"}`,
        sha: a.sha,
        quote: a.title,
        detail: a.answer,
      },
    ];
  });
}

function rebaseEvents(s: Session): LogEvent[] {
  if (!s.rebased_from || !s.rebased_to) return [];
  return [
    {
      at: null,
      text: `Last automatic rebase moved the branch from ${s.rebased_from.slice(0, 7)} to ${s.rebased_to.slice(0, 7)}`,
    },
  ];
}

export function usageRows(id: string): LogUsageRow[] {
  const calls = db
    .prepare(
      `SELECT role, model, provider, COUNT(*) AS turns,
         SUM(input_tokens) AS input_tokens,
         SUM(output_tokens) AS output_tokens,
         SUM(cache_read_tokens) AS cache_read_tokens,
         SUM(cache_write_5m_tokens + cache_write_1h_tokens) AS cache_write_tokens
       FROM usage_calls WHERE task_id = ? GROUP BY role, model, provider`
    )
    .all(id) as {
    role: string | null;
    model: string | null;
    provider: string | null;
    turns: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
  }[];
  const { prices } = effectiveModels();
  const label = (role: string | null) =>
    role?.startsWith("gate-") ? role.slice(5) : (role ?? "unrecorded");
  const rows = calls.map((c): LogUsageRow => {
    const priced = {
      provider: c.provider ?? ANTHROPIC,
      model: c.model,
      cost_usd: 0,
      input_tokens: c.input_tokens,
      output_tokens: c.output_tokens,
      cache_read_tokens: c.cache_read_tokens,
      cache_write_tokens: c.cache_write_tokens,
    };
    const cost = estimateCost(priced, prices);
    const m = rowModel(priced);
    return {
      role: label(c.role),
      model: `${m.provider}/${m.model}`,
      turns: c.turns,
      inputTokens: c.input_tokens,
      outputTokens: c.output_tokens,
      cacheReadTokens: c.cache_read_tokens,
      cacheWriteTokens: c.cache_write_tokens,
      costUsd: cost.usd,
      unpriced: !cost.priced,
    };
  });
  const order = ["plan", "implement", "review", "scope"];
  const rank = (r: string) =>
    order.indexOf(r) === -1 ? order.length : order.indexOf(r);
  return rows.sort(
    (a, b) => rank(a.role) - rank(b.role) || b.costUsd - a.costUsd
  );
}

// The last thing the task's agent said, verbatim. A terminal task keeps no
// conversation, so it has none.
export function finalMessage(id: string): string | null {
  const said = itemsOfKind(id, "assistant").filter((i) => i.text.trim());
  return said.at(-1)?.text ?? null;
}

export interface GatherOpts {
  // The plan file's text when it was read before the worktree went; undefined
  // when nobody could (the backfill), which a log says.
  plan?: string | null;
  planKept?: boolean;
  // The PR's head when it merged, and the commit the merge made.
  head?: string | null;
  mergeCommit?: string | null;
}

export function gatherLogData(s: Session, opts: GatherOpts = {}): LogData {
  const project = s.project_id ? getProject(s.project_id) : undefined;
  const workspaceId = s.workspace_id ?? project?.workspace_id ?? null;
  const workspace = workspaceId ? getWorkspace(workspaceId) : null;
  const amendments = amendmentsOf(s.id);
  const mergedAt = s.merged_at ?? null;
  const head = opts.head ?? null;
  const events: LogEvent[] = [
    ...(s.pr_number
      ? [{ at: null, text: `PR #${s.pr_number} opened` } as LogEvent]
      : []),
    ...failureEvents(s.id),
    ...checkEvents(s.id, head),
    ...askEvents(s.id),
  ];
  // Dated events in time order (a stable sort keeps same-second ones as
  // recorded); the undated ones bracket them: the PR opening first, the
  // rebase before the merge.
  const dated = events
    .filter((e) => e.at)
    .sort((a, b) => (a.at as string).localeCompare(b.at as string));
  const opened = events.filter((e) => !e.at);
  const timeline = [
    ...opened,
    ...dated,
    ...rebaseEvents(s),
    {
      at: mergedAt,
      text: `PR${s.pr_number ? ` #${s.pr_number}` : ""} merged`,
    },
  ];
  return {
    id: s.id,
    name: s.name,
    workspace: workspace?.name ?? null,
    project: project?.name ?? null,
    branch: s.branch_name,
    prNumber: s.pr_number,
    prUrl: s.pr_url,
    mergeCommit: opts.mergeCommit ?? null,
    startedAt: s.created_at,
    mergedAt,
    prompt: s.task_prompt ?? "",
    scopeChanges: amendments.map((a) => ({ at: a.created_at, text: a.text })),
    plan: opts.plan ?? null,
    planKept: opts.planKept ?? true,
    timeline,
    usage: usageRows(s.id),
    outcome: finalMessage(s.id),
    sessionPath: sessionPath(s),
  };
}
