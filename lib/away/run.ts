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
import { notifyPhone } from "../notify";
import { takeFoldedPushes } from "../notify/push";
import { getProject } from "../projects";
import { loadProjectConfig } from "../project-config";
import { run } from "../tasks/gh";
import { git } from "../git-exec";
import { expandHome } from "../tasks/session";
import { auditId, auditsRoot, writeAtomic } from "../session-audit/store";
import {
  activeAway,
  claimSweep,
  reachedWorkspaces,
  toldKey,
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
import {
  agentLive,
  awayWindowMs,
  lastTurnAt,
  saadMessagedRecently,
} from "./activity";
import { checkDeploy } from "./deploy";
import { buildAwayReport, phoneSummary, reportMarkdown } from "./report";
import { awayOnLine } from "./brief";

const PHONE_SOURCE = "away";
const PHONE_LINES = 8;
const GIT_AT_ONCE = 4;

// Every workspace with an orchestrator, by id.
function orchestrated(): { workspaceId: string; orchestratorId: string }[] {
  return listOrchestrators()
    .filter((o) => o.workspace_id && getWorkspace(o.workspace_id))
    .map((o) => ({ workspaceId: o.workspace_id!, orchestratorId: o.id }));
}

const sessionRow = (id: string) =>
  db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as
    | Session
    | undefined;

// Away mode reaches a workspace only through an orchestrator that's been
// working inside the window: one left alone isn't told or woken.
export function orchestratorActive(
  orchestratorId: string,
  now = Date.now()
): boolean {
  const s = sessionRow(orchestratorId);
  if (!s) return false;
  const turn = lastTurnAt(s);
  return turn > 0 && now - turn <= awayWindowMs();
}

// Tells an active orchestrator Saad is away: once a period, or again when
// `resend` (the end moved). False when it isn't active (now), so it's
// left alone.
function tellAway(
  away: AwayRow,
  workspaceId: string,
  orchestratorId: string,
  now: number,
  resend = false
): boolean {
  // Checked every time: a digest's own turn isn't activity, so Away can't
  // keep an orchestrator going that nothing else has.
  if (!orchestratorActive(orchestratorId, now)) return false;
  const told = reachedWorkspaces(away.id).has(workspaceId);
  // A first message goes only to one Saad has messaged lately: waking the
  // rest re-reads their whole context for nothing, and they read the away
  // state in their brief when they next start. One already told keeps its
  // sweeps for the rest of the period.
  if (!told) {
    const s = sessionRow(orchestratorId);
    if (!s || !saadMessagedRecently(s, now)) return false;
  }
  // One transaction: a crash can't leave the marker set with the event
  // never queued.
  db.transaction(() => {
    if (!told) {
      db.prepare(
        `INSERT OR IGNORE INTO away_actions (away_id, workspace_id, subject, kind, key)
         VALUES (?, ?, ?, 'told', ?)`
      ).run(away.id, workspaceId, orchestratorId, toldKey(workspaceId));
      addNote(
        workspaceId,
        `Saad turned Away on, ${untilText(away, now)}.`,
        "away"
      );
    }
    if (!told || resend)
      queueEvent(
        workspaceId,
        `away:${away.id}`,
        null,
        awayOnLine(away, now),
        now
      );
  })();
  return true;
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
  for (const { workspaceId, orchestratorId } of orchestrated()) {
    tellAway(row, workspaceId, orchestratorId, now, !started);
  }
  return row;
}

// Ends Away, builds the report, keeps it, and tells the orchestrators and
// his phone. Null when it was already off.
export function turnAwayOff(
  by: "saad" | "expired",
  now = Date.now()
): AwayRow | null {
  // Ended and its report kept together: a throw or a crash between them
  // can't leave a period over with no report. A throw keeps Away on.
  const done = db.transaction(() => {
    const row = endAway(by, now);
    if (!row) return null;
    const report = buildAwayReport(
      row,
      deployConfigured,
      reachedWorkspaces(row.id)
    );
    saveReport(row.id, report);
    return { ended: row, report };
  })();
  if (!done) return null;
  const { ended, report } = done;
  try {
    writeAtomic(reportFile(ended), reportMarkdown(report));
  } catch (error) {
    console.error("[away] couldn't write the report file:", error);
  }
  const line =
    by === "expired"
      ? "Away mode ran out: Saad may be back. Go back to reacting to events; don't drive interactive sessions."
      : "Saad is back: Away mode is off. Go back to reacting to events.";
  for (const workspaceId of reachedWorkspaces(ended.id)) {
    queueEvent(workspaceId, `away-back:${ended.id}`, null, line, now);
    addNote(
      workspaceId,
      by === "expired" ? "Away ran out." : "Saad turned Away off.",
      "away"
    );
  }
  // What came up since the last sweep's batch (a held `aos notify` is in
  // no report), then the summary. A second later, so the window takes
  // everything up to now.
  notifyBatch(ended, now + 1000);
  notifyPhone(PHONE_SOURCE, phoneSummary(report), {
    category: "digest",
    key: `digest:end:${ended.id}`,
    collapse: "digest",
  });
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
// sending it twice. Refused once Away is off or the workspace is paused,
// so a sweep under way stops acting the moment either changes.
function claim(
  away: AwayRow,
  workspaceId: string,
  subject: string,
  kind: string,
  key: string,
  detail: string | null = null
): boolean {
  if (isPaused(workspaceId)) return false;
  return (
    db
      .prepare(
        `INSERT OR IGNORE INTO away_actions (away_id, workspace_id, subject, kind, key, detail)
         SELECT ?, ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM away_periods WHERE id = ? AND ended_at IS NULL)`
      )
      .run(away.id, workspaceId, subject, kind, key, detail, away.id)
      .changes === 1
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

async function dirtySessions(ids: string[]): Promise<Set<string>> {
  const dirty = new Set<string>();
  // A few at a time: a burst of spawns is what loads the machine.
  for (let i = 0; i < ids.length; i += GIT_AT_ONCE)
    await Promise.all(
      ids.slice(i, i + GIT_AT_ONCE).map(async (id) => {
        const s = sessionRow(id);
        // A linked machine's worktree isn't on this disk.
        if (!s || (s.host_id && s.host_id !== "local")) return;
        const dir = expandHome(s.worktree_path || s.working_directory);
        const out = await git(dir, [
          "status",
          "--porcelain",
          "--untracked-files=normal",
        ]).catch(() => "");
        if (out.trim()) dirty.add(id);
      })
    );
  return dirty;
}

// A lost review run again: a reviewer, never a message to the session.
async function rerunReview(
  away: AwayRow,
  workspaceId: string,
  c: Candidate
): Promise<string | null> {
  if (!claim(away, workspaceId, c.sessionId, c.kind, c.key)) return null;
  try {
    await review(workspaceId, c.sessionId);
    return c.line;
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return `${c.line.replace(/; AgentOS ran it again\.$/, "")}; running it again failed: ${clip(why, 200)}`;
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

// Each task merged while away, until its deploy is decided. Returns the
// digest's line for each one decided now.
// Claimed with the digest that reports it, so a crash in between can't
// leave a deploy marked as reported that never was.
class EmptyDigest extends Error {}

interface DeployFinding {
  subject: string;
  kind: string;
  key: string;
  detail: string;
  line: string;
}

async function checkDeploys(
  away: AwayRow,
  workspaceId: string,
  now: number
): Promise<DeployFinding[]> {
  const found: DeployFinding[] = [];
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
    const key = `deploy:${s.id}`;
    if (verdict.state === "unchecked") {
      claim(away, workspaceId, s.id, kind, key, verdict.detail);
      continue;
    }
    found.push({
      subject: s.id,
      kind,
      key,
      detail: verdict.detail,
      line: `task ${s.name}: PR #${s.pr_number ?? "?"} merged; ${verdict.state === "ok" ? verdict.detail : `deploy failed: ${verdict.detail}`}`,
    });
  }
  return found;
}

const DIGEST_HEAD =
  "Away sweep: what changed in this workspace since the last digest. Sessions not listed had no real activity inside the window or nothing new; leave them alone.";

const candidateLabel: Record<Candidate["kind"], string> = {
  stalled: "stalled",
  commit: "uncommitted, no PR",
  review: "review",
  wrapup: "interactive",
};

// Sweeps a workspace whose orchestrator is active: lost reviews run again,
// deploys checked, and what's new goes to the orchestrator as one digest
// event. No other session is ever messaged. Returns the digest, if one went.
export async function sweepWorkspace(
  away: AwayRow,
  workspaceId: string,
  orchestratorId: string,
  now = Date.now()
): Promise<string | null> {
  // Paused means it acts on nothing, the sweep included.
  if (isPaused(workspaceId)) return null;
  if (!tellAway(away, workspaceId, orchestratorId, now)) return null;
  const facts = await sessionFacts(workspaceId);
  const acted = actedKeys(away.id, workspaceId);
  const rows = new Map(
    facts.map((f) => [f.id, sessionRow(f.id)] as const).filter(([, s]) => s)
  ) as Map<string, Session>;
  const turns = new Map([...rows].map(([id, s]) => [id, lastTurnAt(s)]));
  const live = new Set(
    facts
      .filter((f) => !f.task && rows.has(f.id) && agentLive(rows.get(f.id)!))
      .map((f) => f.id)
  );
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
  const windowMs = awayWindowMs();
  const dirty = await dirtySessions(
    needsGitCheck({ facts, now, turns, windowMs, live, held, acted })
  );
  const { flags, reviews, firstSeen } = pickCandidates({
    now,
    facts,
    turns,
    windowMs,
    live,
    dirty,
    held,
    acted,
    reviewOf: (id, sha) => {
      const c = getCheck(id, sha, "review");
      return c ? { status: c.status, at: fromSql(c.created_at) } : null;
    },
  });
  for (const key of firstSeen)
    claim(away, workspaceId, key.split(":")[1], "seen", key);
  const lines: string[] = [];
  for (const c of reviews) {
    const line = await rerunReview(away, workspaceId, c);
    if (line) lines.push(`- review: ${line}`);
  }
  const deploys = await checkDeploys(away, workspaceId, now);
  if (!flags.length && !deploys.length && !lines.length) return null;
  // Claimed like the rest, so a period's digests are counted and a sweep
  // that ended meanwhile sends none. The digest, its event and the
  // candidates it reports commit together.
  const send = db.transaction((): string => {
    if (
      !claim(
        away,
        workspaceId,
        orchestratorId,
        "digest",
        `digest:${workspaceId}:${now}`
      )
    )
      throw new EmptyDigest();
    const items = [...lines];
    for (const c of flags)
      if (claim(away, workspaceId, c.sessionId, c.kind, c.key))
        items.push(`- ${candidateLabel[c.kind]}: ${c.line}`);
    for (const d of deploys)
      if (claim(away, workspaceId, d.subject, d.kind, d.key, d.detail))
        items.push(`- deploy: ${d.line}`);
    if (!items.length) throw new EmptyDigest();
    const text = [DIGEST_HEAD, ...items].join("\n");
    queueEvent(workspaceId, `away-digest:${away.id}:${now}`, null, text, now);
    addNote(
      workspaceId,
      `Away sweep: sent the orchestrator a digest of ${items.length} ${items.length === 1 ? "item" : "items"}.`,
      "away"
    );
    return text;
  });
  try {
    return send();
  } catch (e) {
    if (e instanceof EmptyDigest) return null;
    throw e;
  }
}

// One phone message for what came up since the last: new asks across
// every workspace, and deploys that failed.
export function notifyBatch(away: AwayRow, now = Date.now()): string | null {
  // [since, until): a row made in the second of this batch goes in the
  // next one, never in none.
  const since = away.asks_notified_at ?? away.started_at;
  const until = toSql(now);
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
       WHERE a.status = 'open' AND a.created_at >= ? AND a.created_at < ? ORDER BY a.id`
    )
    .all(since, until) as { kind: string; title: string; workspace: string }[];
  // Failed deploys, and what orchestrators sent with `aos notify` while
  // he was away (held for this batch).
  const held = db
    .prepare(
      `SELECT a.kind, a.detail, w.name AS workspace FROM away_actions a
       JOIN workspaces w ON w.id = a.workspace_id
       WHERE a.away_id = ? AND a.kind IN ('deploy_failed', 'notify')
         AND a.created_at >= ? AND a.created_at < ?
       ORDER BY a.id`
    )
    .all(away.id, since, until) as {
    kind: string;
    detail: string | null;
    workspace: string;
  }[];
  const deploys = held.filter((h) => h.kind === "deploy_failed");
  const notes = held.filter((h) => h.kind === "notify");
  // What push held for this digest (ready for review, CI, agent messages).
  const pushed = takeFoldedPushes(now);
  if (!asks.length && !held.length && !pushed) return null;
  const lines = [
    ...deploys.map(
      (d) => `- ${d.workspace}: deploy failed: ${clip(d.detail ?? "", 120)}`
    ),
    ...asks.map((a) => `- ${a.workspace}: ${a.kind}: ${clip(a.title, 100)}`),
    ...notes.map((n) => `- ${n.workspace}: ${clip(n.detail ?? "", 160)}`),
  ];
  const count = (n: number, one: string, many: string) =>
    n ? [`${n} ${n === 1 ? one : many}`] : [];
  const parts = [
    ...count(asks.length, "new ask", "new asks"),
    ...count(deploys.length, "failed deploy", "failed deploys"),
    ...count(
      notes.length,
      "note from an orchestrator",
      "notes from orchestrators"
    ),
    ...count(pushed, "other update", "other updates"),
  ];
  const head = `While you're away: ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]}`;
  const shown = lines.slice(0, PHONE_LINES);
  const more = lines.length - shown.length;
  const text = [head, ...shown, ...(more ? [`- and ${more} more`] : [])].join(
    "\n"
  );
  notifyPhone(PHONE_SOURCE, text, {
    category: "digest",
    key: `digest:${away.id}:${now}`,
    collapse: "digest",
  });
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
