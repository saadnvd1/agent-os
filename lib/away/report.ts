/**
 * "While you were away": what happened in every workspace between Away on
 * and off, read straight from the database, no model involved. Built once
 * as Away ends and kept with the period, so it reads the same later.
 */

import { db } from "../db";
import { listWorkspaces } from "../workspaces";
import { HARD_LINES, openAsks } from "../orchestrator/asks";
import {
  checksBySession,
  clip,
  failuresBySession,
  type CheckRow,
  type FailureRow,
} from "../orchestrator/digest";
import type { AskKind } from "../orchestrator/ask-view";
import { clockTime, fromSql, type AwayRow } from "./state";

export type DeployState = "deployed" | "failed" | "pending" | "unchecked";

export interface MergedItem {
  task: string;
  project: string;
  pr: number | null;
  url: string | null;
  deploy: DeployState;
  deployDetail: string | null;
}

export interface InFlightItem {
  task: string;
  project: string;
  pr: number | null;
  url: string | null;
  why: string;
}

export interface FailedItem {
  what: string;
  url: string | null;
}

export interface WaitingItem {
  askId: number;
  kind: AskKind;
  title: string;
  hardLine: boolean;
  url: string | null;
}

export interface WorkspaceReport {
  id: string;
  name: string;
  merged: MergedItem[];
  inFlight: InFlightItem[];
  failed: FailedItem[];
  waiting: WaitingItem[];
}

export interface AwayReport {
  awayId: number;
  startedAt: string;
  endedAt: string;
  endedBy: string | null;
  setBy: string;
  // Workspaces with anything to say, in sidebar order.
  workspaces: WorkspaceReport[];
  totals: {
    merged: number;
    deployed: number;
    deployFailed: number;
    inFlight: number;
    failed: number;
    waiting: number;
    hardLines: number;
  };
}

const sha7 = (sha: string) => sha.slice(0, 7);

// Why a running task hasn't merged yet, in the order that matters to Saad:
// his, then broken, then waiting on the pipeline.
export function inFlightWhy(t: {
  prNumber: number | null;
  armed: boolean;
  checks: CheckRow[];
  failures: FailureRow[];
  askKinds: string[];
  nudges: number;
}): string {
  const escalated = t.failures.filter((f) => f.escalated_at);
  if (escalated.length)
    return `with you: the ${escalated.map((f) => f.gate).join(" and ")} gate failed twice`;
  if (t.askKinds.length) return `waiting on your answer (${t.askKinds[0]})`;
  const nudged = t.nudges ? `; nudged ${t.nudges}x while you were away` : "";
  if (!t.prNumber) return `no PR yet${nudged}`;
  const of = (kind: string) => t.checks.find((c) => c.kind === kind);
  const review = of("review");
  const ci = of("ci");
  if (ci && ci.status !== "pass" && ci.status !== "running")
    return `CI failing at ${sha7(ci.sha)}${nudged}`;
  if (review?.status === "block")
    return `review found blocking issues at ${sha7(review.sha)}`;
  const failed = t.failures.filter((f) => f.count > 0);
  if (failed.length)
    return `the ${failed.map((f) => f.gate).join(" and ")} gate failed once; retrying`;
  if (review?.status === "running")
    return `review of ${sha7(review.sha)} running`;
  if (!review || review.status === "error")
    return "PR open, waiting on its review";
  if (t.armed) return "armed to merge, waiting on its gates";
  return "PR open and reviewed, waiting on sign-off";
}

interface TaskRow {
  id: string;
  name: string;
  project: string;
  pr_number: number | null;
  pr_url: string | null;
  armed_at: string | null;
}

function merged(
  workspaceId: string,
  away: AwayRow,
  end: string,
  deployConfigured: (projectId: string) => boolean
): MergedItem[] {
  const rows = db
    .prepare(
      `SELECT s.id, s.name, p.name AS project, p.id AS project_id, s.pr_number, s.pr_url
       FROM sessions s JOIN projects p ON p.id = s.project_id
       WHERE p.workspace_id = ? AND s.task_status = 'merged'
         AND s.merged_at >= ? AND s.merged_at <= ?
       ORDER BY s.merged_at, s.id`
    )
    .all(workspaceId, away.started_at, end) as (TaskRow & {
    project_id: string;
  })[];
  const action = db.prepare(
    `SELECT kind, detail FROM away_actions WHERE away_id = ? AND key = ?`
  );
  return rows.map((r) => {
    const done = action.get(away.id, `deploy:${r.id}`) as
      | { kind: string; detail: string | null }
      | undefined;
    const deploy: DeployState =
      done?.kind === "deploy_ok"
        ? "deployed"
        : done?.kind === "deploy_failed"
          ? "failed"
          : done?.kind === "deploy_unchecked" || !deployConfigured(r.project_id)
            ? "unchecked"
            : "pending";
    return {
      task: r.name,
      project: r.project,
      pr: r.pr_number,
      url: r.pr_url,
      deploy,
      deployDetail: done?.detail ?? null,
    };
  });
}

function inFlight(workspaceId: string, awayId: number): InFlightItem[] {
  const tasks = db
    .prepare(
      `SELECT s.id, s.name, p.name AS project, s.pr_number, s.pr_url,
         s.merge_armed_at AS armed_at
       FROM sessions s JOIN projects p ON p.id = s.project_id
       WHERE p.workspace_id = ? AND s.role IS NULL AND s.archived_at IS NULL
         AND s.task_status = 'running'
       ORDER BY s.created_at, s.id`
    )
    .all(workspaceId) as TaskRow[];
  if (!tasks.length) return [];
  const checks = checksBySession(workspaceId);
  const failures = failuresBySession(workspaceId);
  const asks = openAsks(workspaceId);
  const nudges = db.prepare(
    `SELECT COUNT(*) AS n FROM away_actions
     WHERE away_id = ? AND subject = ? AND kind = 'nudge'`
  );
  return tasks.map((t) => ({
    task: t.name,
    project: t.project,
    pr: t.pr_number,
    url: t.pr_url,
    why: inFlightWhy({
      prNumber: t.pr_number,
      armed: !!t.armed_at,
      checks: checks.get(t.id) ?? [],
      failures: failures.get(t.id) ?? [],
      askKinds: asks
        .filter((a) => a.subject === `task:${t.id}`)
        .map((a) => a.kind),
      nudges: (nudges.get(awayId, t.id) as { n: number }).n,
    }),
  }));
}

function failed(workspaceId: string, away: AwayRow, end: string) {
  const escalations = db
    .prepare(
      `SELECT text FROM orchestrator_notes
       WHERE workspace_id = ? AND kind = 'escalation'
         AND created_at >= ? AND created_at <= ?
       ORDER BY id`
    )
    .all(workspaceId, away.started_at, end) as { text: string }[];
  const deploys = db
    .prepare(
      `SELECT a.detail, s.name, s.pr_number, s.pr_url FROM away_actions a
       LEFT JOIN sessions s ON s.id = a.subject
       WHERE a.away_id = ? AND a.workspace_id = ? AND a.kind = 'deploy_failed'
       ORDER BY a.id`
    )
    .all(away.id, workspaceId) as {
    detail: string | null;
    name: string | null;
    pr_number: number | null;
    pr_url: string | null;
  }[];
  return [
    ...deploys.map((d) => ({
      what: `Deploy failed after ${d.name ?? "a task"}${d.pr_number ? ` (PR #${d.pr_number})` : ""} merged: ${d.detail ?? "no detail"}`,
      url: d.pr_url,
    })),
    ...escalations.map((e) => ({ what: clip(e.text), url: null })),
  ];
}

function waiting(workspaceId: string): WaitingItem[] {
  return openAsks(workspaceId).map((a) => ({
    askId: a.id,
    kind: a.kind,
    title: clip(a.title, 160),
    hardLine: HARD_LINES.includes(a.kind),
    url: a.link,
  }));
}

export function buildAwayReport(
  away: AwayRow,
  deployConfigured: (projectId: string) => boolean
): AwayReport {
  const end = away.ended_at ?? away.started_at;
  const workspaces = listWorkspaces()
    .map((w) => ({
      id: w.id,
      name: w.name,
      merged: merged(w.id, away, end, deployConfigured),
      inFlight: inFlight(w.id, away.id),
      failed: failed(w.id, away, end),
      waiting: waiting(w.id),
    }))
    .filter(
      (w) =>
        w.merged.length ||
        w.inFlight.length ||
        w.failed.length ||
        w.waiting.length
    );
  const all = <T>(pick: (w: WorkspaceReport) => T[]) =>
    workspaces.flatMap(pick);
  const mergedAll = all((w) => w.merged);
  const waitingAll = all((w) => w.waiting);
  return {
    awayId: away.id,
    startedAt: away.started_at,
    endedAt: end,
    endedBy: away.ended_by,
    setBy: away.set_by,
    workspaces,
    totals: {
      merged: mergedAll.length,
      deployed: mergedAll.filter((m) => m.deploy === "deployed").length,
      deployFailed: mergedAll.filter((m) => m.deploy === "failed").length,
      inFlight: all((w) => w.inFlight).length,
      failed: all((w) => w.failed).length,
      waiting: waitingAll.length,
      hardLines: waitingAll.filter((a) => a.hardLine).length,
    },
  };
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

// The phone's version: counts, and whether anything waits on him.
export function phoneSummary(r: AwayReport): string {
  const t = r.totals;
  const deploy = t.merged
    ? ` (${t.deployed} deployed${t.deployFailed ? `, ${t.deployFailed} deploy failed` : ""})`
    : "";
  const waiting = t.waiting
    ? `${plural(t.waiting, "ask")} waiting on you${t.hardLines ? `, ${t.hardLines} a hard line` : ""}.`
    : "Nothing waiting on you.";
  return [
    `While you were away: ${t.merged} merged${deploy}, ${t.inFlight} in flight, ${t.failed} failed or escalated.`,
    waiting,
    "The full report is in AgentOS.",
  ].join(" ");
}

const DEPLOY_WORD: Record<DeployState, string> = {
  deployed: "deployed",
  failed: "deploy failed",
  pending: "deploy not confirmed yet",
  unchecked: "no deploy check",
};

// Task names, ask titles and log lines are text agents wrote: no markup.
const esc = (text: string) => text.replace(/[[\]<>`*_]/g, "\\$&");
const safeUrl = (url: string | null) =>
  url && /^https:\/\/[^\s()<>]+$/.test(url) ? url : null;
const link = (label: string, url: string | null) =>
  safeUrl(url) ? `[${label}](${url})` : label;

// For Settings > Audits: a markdown file with the same content.
export function reportMarkdown(r: AwayReport): string {
  const from = clockTime(fromSql(r.startedAt), fromSql(r.endedAt));
  const to = clockTime(fromSql(r.endedAt), fromSql(r.endedAt));
  const out = [
    `---\naudited: ${new Date(fromSql(r.endedAt)).toISOString()}\n---`,
    `# While you were away (${from} to ${to})`,
    "",
    phoneSummary(r).replace(" The full report is in AgentOS.", ""),
  ];
  const section = (title: string, lines: string[], empty: string) => {
    out.push("", `## ${title}`, "");
    out.push(...(lines.length ? lines : [empty]));
  };
  const each = <T>(
    pick: (w: WorkspaceReport) => T[],
    line: (item: T) => string
  ) =>
    r.workspaces.flatMap((w) =>
      pick(w).map((item) => `- **${esc(w.name)}**: ${line(item)}`)
    );
  section(
    "Merged",
    each(
      (w) => w.merged,
      (m) =>
        `${m.pr ? `${link(`PR #${m.pr}`, m.url)} ` : ""}${esc(m.task)} (${esc(m.project)}): ${DEPLOY_WORD[m.deploy]}${m.deployDetail ? `, ${esc(m.deployDetail)}` : ""}`
    ),
    "- None."
  );
  section(
    "Still in flight",
    each(
      (w) => w.inFlight,
      (t) =>
        `${t.pr ? `${link(`PR #${t.pr}`, t.url)} ` : ""}${esc(t.task)} (${esc(t.project)}): ${t.why}`
    ),
    "- None."
  );
  section(
    "Failed or escalated",
    each(
      (w) => w.failed,
      (f) => `${esc(f.what)}${safeUrl(f.url) ? ` (${f.url})` : ""}`
    ),
    "- None."
  );
  section(
    "Waiting on you",
    each(
      (w) => w.waiting,
      (a) =>
        `${a.hardLine ? "**hard line** " : ""}${a.kind}: ${esc(a.title)}${safeUrl(a.url) ? ` (${a.url})` : ""}`
    ),
    "- None."
  );
  return out.join("\n") + "\n";
}
