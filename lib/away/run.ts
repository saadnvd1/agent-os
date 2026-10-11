/**
 * Away mode, in motion: turning it on and off, telling each workspace's
 * orchestrator, the sweep every SWEEP_EVERY_MS while it's on, the batched
 * phone notification, and the report when it ends. Driven by the
 * orchestrator watcher's tick (lib/orchestrator/watcher.ts).
 */

import path from "path";
import { db, type Session } from "../db";
import { getWorkspace } from "../workspaces";
import { queueEvent } from "../orchestrator/events";
import { listOrchestrators } from "../orchestrator/home";
import { addNote } from "../orchestrator/notes";
import { isPaused } from "../orchestrator/pause";
import { sessionFacts } from "../orchestrator/facts";
import { getCheck } from "../orchestrator/checks";
import { holdingEscalations } from "../orchestrator/gates";
import { review } from "../orchestrator/review";
import { repoOf } from "../orchestrator/repo";
import { clip } from "../orchestrator/digest";
import { sendMessage } from "../bus";
import { notifyPhone } from "../notify";
import { getProject } from "../projects";
import { loadProjectConfig } from "../project-config";
import { run } from "../tasks/gh";
import { expandHome } from "../tasks/session";
import { auditId, auditsRoot, writeAtomic } from "../session-audit/store";
import {
  activeAway,
  claimSweep,
  endAway,
  fromSql,
  isExpired,
  saveReport,
  startAway,
  toSql,
  untilText,
  type AwayRow,
} from "./state";
import {
  needsGitCheck,
  pickCandidates,
  SWEEP_EVERY_MS,
  type Candidate,
} from "./sweep";
import { checkDeploy } from "./deploy";
import { buildAwayReport, phoneSummary, reportMarkdown } from "./report";
import { awayOnLine } from "./brief";

const PHONE_SOURCE = "away";
const PHONE_LINES = 8;

// Every workspace with an orchestrator, by id.
function orchestrated(): { workspaceId: string; orchestratorId: string }[] {
  return listOrchestrators()
    .filter((o) => o.workspace_id && getWorkspace(o.workspace_id))
    .map((o) => ({ workspaceId: o.workspace_id!, orchestratorId: o.id }));
}

function tellOrchestrators(key: string, line: string, now: number): void {
  for (const { workspaceId } of orchestrated())
    queueEvent(workspaceId, key, null, line, now);
}

// In Settings > Audits under "away", named for when it ended (local time)
// and its period, so another database's reports never overwrite it.
export const reportFile = (row: AwayRow) =>
  path.join(
    auditsRoot(),
    "away",
    `${auditId(new Date(fromSql(row.ended_at ?? row.started_at)))}-${row.id}.md`
  );

export function turnAwayOn(
  input: { setBy: string; expiresAt: number | null },
  now = Date.now()
): AwayRow {
  const { row, started } = startAway(input, now);
  // Sent again when the end moves, so the orchestrator has the new one.
  tellOrchestrators(`away:${row.id}`, awayOnLine(row, now), now);
  if (started)
    for (const { workspaceId } of orchestrated())
      addNote(
        workspaceId,
        `Saad turned Away on, ${untilText(row, now)}.`,
        "away"
      );
  return row;
}

// Ends Away, builds the report, keeps it, and tells the orchestrators and
// his phone. Null when it was already off.
export function turnAwayOff(
  by: "saad" | "expired",
  now = Date.now()
): AwayRow | null {
  const ended = endAway(by, now);
  if (!ended) return null;
  const report = buildAwayReport(ended, deployConfigured);
  saveReport(ended.id, report);
  try {
    writeAtomic(reportFile(ended), reportMarkdown(report));
  } catch (error) {
    console.error("[away] couldn't write the report file:", error);
  }
  const line =
    by === "expired"
      ? "Away mode ran out: Saad may be back. Go back to reacting to events; don't drive interactive sessions."
      : "Saad is back: Away mode is off. Go back to reacting to events.";
  tellOrchestrators(`back:${ended.id}`, line, now);
  for (const { workspaceId } of orchestrated())
    addNote(
      workspaceId,
      by === "expired" ? "Away ran out." : "Saad turned Away off.",
      "away"
    );
  notifyPhone(PHONE_SOURCE, phoneSummary(report));
  return { ...ended, report: JSON.stringify(report) };
}

function deployConfigured(projectId: string): boolean {
  const project = getProject(projectId);
  return (
    !!project &&
    !!loadProjectConfig(expandHome(project.working_directory)).config.deploy
  );
}

// Claimed before it's acted on: a crash loses one nudge rather than
// sending it twice.
function claim(
  away: AwayRow,
  workspaceId: string,
  subject: string,
  kind: string,
  key: string,
  detail: string | null = null
): boolean {
  return (
    db
      .prepare(
        `INSERT OR IGNORE INTO away_actions (away_id, workspace_id, subject, kind, key, detail)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(away.id, workspaceId, subject, kind, key, detail).changes === 1
  );
}

function actedKeys(awayId: number, workspaceId: string): Set<string> {
  return new Set(
    (
      db
        .prepare(
          `SELECT key FROM away_actions WHERE away_id = ? AND workspace_id = ?`
        )
        .all(awayId, workspaceId) as { key: string }[]
    ).map((r) => r.key)
  );
}

function nudgeCounts(awayId: number, workspaceId: string): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT subject, COUNT(*) AS n FROM away_actions
       WHERE away_id = ? AND workspace_id = ? AND kind = 'nudge' GROUP BY subject`
    )
    .all(awayId, workspaceId) as { subject: string; n: number }[];
  return new Map(rows.map((r) => [r.subject, r.n]));
}

const sessionRow = (id: string) =>
  db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as
    | Session
    | undefined;

async function dirtySessions(ids: string[]): Promise<Set<string>> {
  const dirty = new Set<string>();
  await Promise.all(
    ids.map(async (id) => {
      const s = sessionRow(id);
      // A linked machine's worktree isn't on this disk.
      if (!s || (s.host_id && s.host_id !== "local")) return;
      const dir = expandHome(s.worktree_path || s.working_directory);
      const out = await run(
        "git",
        ["status", "--porcelain", "--untracked-files=normal"],
        dir
      ).catch(() => "");
      if (out.trim()) dirty.add(id);
    })
  );
  return dirty;
}

async function act(
  away: AwayRow,
  workspaceId: string,
  orchestratorId: string,
  c: Candidate
): Promise<void> {
  if (!claim(away, workspaceId, c.sessionId, c.kind, c.key)) return;
  try {
    if (c.kind === "review") await review(workspaceId, c.sessionId);
    else
      await sendMessage({
        fromId: orchestratorId,
        to: c.sessionId,
        body: c.message!,
      });
    addNote(workspaceId, `Away sweep: ${c.log}`, "away");
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    addNote(
      workspaceId,
      `Away sweep: ${c.log} It didn't go through: ${clip(why, 200)}`,
      "away"
    );
  }
}

const SHA = /^[0-9a-f]{40}$/;

async function mergeCommit(repo: string, pr: number): Promise<string | null> {
  const out = await run(
    "gh",
    [
      "pr",
      "view",
      String(pr),
      "--json",
      "mergeCommit",
      "--jq",
      ".mergeCommit.oid",
    ],
    repo
  ).catch(() => "");
  const sha = out.trim();
  return SHA.test(sha) ? sha : null;
}

// Each task merged while away, until its deploy is decided.
async function checkDeploys(
  away: AwayRow,
  workspaceId: string,
  now: number
): Promise<void> {
  const merged = db
    .prepare(
      `SELECT s.* FROM sessions s JOIN projects p ON p.id = s.project_id
       WHERE p.workspace_id = ? AND s.task_status = 'merged' AND s.merged_at >= ?
         AND NOT EXISTS (SELECT 1 FROM away_actions a
           WHERE a.away_id = ? AND a.key = 'deploy:' || s.id)`
    )
    .all(workspaceId, away.started_at, away.id) as Session[];
  for (const s of merged) {
    let repo: string;
    try {
      repo = repoOf(s);
    } catch {
      continue;
    }
    const config = loadProjectConfig(repo).config.deploy;
    const verdict = await checkDeploy({
      repo,
      config,
      mergeSha:
        config && s.pr_number ? await mergeCommit(repo, s.pr_number) : null,
      mergedAt: s.merged_at ? fromSql(s.merged_at) : now,
      now,
    });
    if (verdict.state === "pending") continue;
    const kind =
      verdict.state === "ok"
        ? "deploy_ok"
        : verdict.state === "failed"
          ? "deploy_failed"
          : "deploy_unchecked";
    if (!claim(away, workspaceId, s.id, kind, `deploy:${s.id}`, verdict.detail))
      continue;
    if (verdict.state === "unchecked") continue;
    const line = `task ${s.name}: PR #${s.pr_number ?? "?"} merged; ${verdict.state === "ok" ? verdict.detail : `deploy failed: ${verdict.detail}`}`;
    addNote(workspaceId, `Away sweep: ${line}`, "away");
    if (verdict.state === "failed")
      queueEvent(workspaceId, `deploy:${s.id}`, s.id, line, now);
  }
}

export async function sweepWorkspace(
  away: AwayRow,
  workspaceId: string,
  orchestratorId: string,
  now = Date.now()
): Promise<void> {
  // Paused means it acts on nothing, the sweep included.
  if (isPaused(workspaceId)) return;
  const facts = await sessionFacts(workspaceId);
  const acted = actedKeys(away.id, workspaceId);
  const dirty = await dirtySessions(needsGitCheck(facts, now, acted));
  const openOn = new Set(
    (
      db
        .prepare(
          `SELECT subject FROM orchestrator_asks WHERE workspace_id = ? AND status = 'open' AND subject LIKE 'task:%'`
        )
        .all(workspaceId) as { subject: string }[]
    ).map((r) => r.subject.slice(5))
  );
  const held = new Set(
    facts
      .filter((f) => openOn.has(f.id) || holdingEscalations(f.id).length)
      .map((f) => f.id)
  );
  const { act: todo, firstSeen } = pickCandidates({
    now,
    facts,
    dirty,
    held,
    acted,
    nudges: nudgeCounts(away.id, workspaceId),
    reviewOf: (id, sha) => {
      const c = getCheck(id, sha, "review");
      return c ? { status: c.status, at: fromSql(c.created_at) } : null;
    },
  });
  for (const key of firstSeen)
    claim(away, workspaceId, key.split(":")[1], "seen", key);
  for (const c of todo) await act(away, workspaceId, orchestratorId, c);
  await checkDeploys(away, workspaceId, now);
}

// One phone message for what came up since the last: new asks across
// every workspace, and deploys that failed.
export function notifyBatch(away: AwayRow, now = Date.now()): string | null {
  const since = away.asks_notified_at ?? away.started_at;
  const claimed = db
    .prepare(
      `UPDATE away_periods SET asks_notified_at = ? WHERE id = ? AND asks_notified_at IS ?`
    )
    .run(toSql(now), away.id, away.asks_notified_at).changes;
  if (!claimed) return null;
  const asks = db
    .prepare(
      `SELECT a.kind, a.title, w.name AS workspace FROM orchestrator_asks a
       JOIN workspaces w ON w.id = a.workspace_id
       WHERE a.status = 'open' AND a.created_at > ? ORDER BY a.id`
    )
    .all(since) as { kind: string; title: string; workspace: string }[];
  const deploys = db
    .prepare(
      `SELECT a.detail, w.name AS workspace FROM away_actions a
       JOIN workspaces w ON w.id = a.workspace_id
       WHERE a.away_id = ? AND a.kind = 'deploy_failed' AND a.created_at > ?
       ORDER BY a.id`
    )
    .all(away.id, since) as { detail: string | null; workspace: string }[];
  if (!asks.length && !deploys.length) return null;
  const lines = [
    ...deploys.map(
      (d) => `- ${d.workspace}: deploy failed: ${clip(d.detail ?? "", 120)}`
    ),
    ...asks.map((a) => `- ${a.workspace}: ${a.kind}: ${clip(a.title, 100)}`),
  ];
  const head =
    asks.length && deploys.length
      ? `While you're away: ${asks.length} new ask${asks.length === 1 ? "" : "s"} and ${deploys.length} failed deploy${deploys.length === 1 ? "" : "s"}`
      : asks.length
        ? `While you're away: ${asks.length} new ask${asks.length === 1 ? "" : "s"} waiting on you`
        : `While you're away: ${deploys.length} deploy${deploys.length === 1 ? "" : "s"} failed`;
  const shown = lines.slice(0, PHONE_LINES);
  const more = lines.length - shown.length;
  const text = [head, ...shown, ...(more ? [`- and ${more} more`] : [])].join(
    "\n"
  );
  notifyPhone(PHONE_SOURCE, text);
  return text;
}

let sweeping = false;

// Every watcher tick: cheap unless a sweep is due. Ends Away when its time
// runs out; otherwise sweeps every SWEEP_EVERY_MS, in the background so
// event delivery never waits on it.
export function awayTick(now = Date.now()): void {
  const away = activeAway();
  if (!away) return;
  if (isExpired(away, now)) {
    turnAwayOff("expired", now);
    return;
  }
  if (sweeping || !claimSweep(away, SWEEP_EVERY_MS, now)) return;
  sweeping = true;
  void (async () => {
    for (const { workspaceId, orchestratorId } of orchestrated()) {
      try {
        await sweepWorkspace(away, workspaceId, orchestratorId, now);
      } catch (error) {
        console.error(`[away] sweep of ${workspaceId}:`, error);
      }
    }
    // Ended meanwhile: the report's summary says what's waiting.
    const still = activeAway();
    if (still?.id === away.id) notifyBatch(still, Date.now());
  })()
    .catch((error) => console.error("[away] sweep:", error))
    .finally(() => {
      sweeping = false;
    });
}
