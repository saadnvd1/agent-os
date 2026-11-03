/**
 * Which sessions AgentOS started and where Claude kept each one's
 * transcript, plus what AgentOS itself recorded about them (checks, notes,
 * asks, messages, chat cost). Reads the database read-only.
 */

import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { claudeProjectDir, isClaudeSessionId } from "../tasks/transcript";
import { normalizeError, scrub } from "./normalize";

export type SessionKind = "task" | "orchestrator" | "chat" | "terminal";

export interface AuditSession {
  id: string;
  name: string;
  kind: SessionKind;
  project: string | null;
  workspaceId: string | null;
  createdAt: string;
  cwd: string;
  files: string[];
  briefChars: number;
}

interface SessionRow {
  id: string;
  name: string;
  created_at: string;
  role: string | null;
  view: string;
  task_prompt: string | null;
  task_brief_chars: number | null;
  working_directory: string;
  worktree_path: string | null;
  claude_session_id: string | null;
  workspace_id: string | null;
  project: string | null;
}

const expand = (p: string, home: string) =>
  p === "~" || p.startsWith("~/") ? path.join(home, p.slice(1)) : p;

/** Folders only one AgentOS session (or one workspace's orchestrator) ever runs in. */
function ownsFolder(cwd: string, home: string): boolean {
  const root = path.join(home, ".agent-os");
  return (
    cwd.startsWith(path.join(root, "worktrees") + "/") ||
    cwd.startsWith(path.join(root, "orchestrators") + "/")
  );
}

function kindOf(row: SessionRow): SessionKind {
  if (row.role === "orchestrator") return "orchestrator";
  if (row.task_prompt) return "task";
  return row.view === "chat" ? "chat" : "terminal";
}

const sqlTime = (ms: number) =>
  new Date(ms).toISOString().replace("T", " ").slice(0, 19);

export function openDb(dbPath: string): Database.Database {
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

/**
 * Every AgentOS session with a transcript touched since `since`, and those
 * transcripts. A folder AgentOS owns (a worktree, an orchestrator's home)
 * gives all its transcripts to the session; a shared one (a project root, the
 * scratch chat folder) only the conversation the session recorded.
 */
export function loadSessions(
  db: Database.Database,
  since: number,
  home = os.homedir()
): AuditSession[] {
  const rows = db
    .prepare(
      `SELECT s.id, s.name, s.created_at, s.role, s.view, s.task_prompt,
              length(s.task_brief) AS task_brief_chars, s.working_directory,
              s.worktree_path, s.claude_session_id, s.workspace_id, p.name AS project
         FROM session_rows s LEFT JOIN projects p ON p.id = s.project_id
        WHERE coalesce(s.host_id, 'local') = 'local'`
    )
    .all() as SessionRow[];

  const sessions = new Map<string, AuditSession>();
  // A folder several sessions shared (an orchestrator restarted, a worktree
  // reused): each transcript goes to the latest session created before it.
  const byFolder = new Map<string, AuditSession[]>();
  const claimed = new Set<string>();

  for (const row of rows) {
    const cwd = expand(row.worktree_path || row.working_directory, home);
    const s: AuditSession = {
      id: row.id,
      name: row.name,
      kind: kindOf(row),
      project: row.project,
      workspaceId: row.workspace_id,
      createdAt: row.created_at,
      cwd,
      files: [],
      briefChars: row.task_brief_chars ?? 0,
    };
    sessions.set(row.id, s);
    if (ownsFolder(cwd, home)) {
      const list = byFolder.get(cwd) ?? [];
      list.push(s);
      byFolder.set(cwd, list);
    } else if (
      row.claude_session_id &&
      isClaudeSessionId(row.claude_session_id)
    ) {
      const file = path.join(
        claudeProjectDir(cwd),
        `${row.claude_session_id}.jsonl`
      );
      if (fresh(file, since)) {
        s.files.push(file);
        claimed.add(file);
      }
    }
  }

  for (const [cwd, owners] of byFolder) {
    const dir = claudeProjectDir(cwd);
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    owners.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const name of names) {
      if (!name.endsWith(".jsonl") || !isClaudeSessionId(name.slice(0, -6)))
        continue;
      const file = path.join(dir, name);
      if (claimed.has(file) || !fresh(file, since)) continue;
      // Some filesystems report no birth time; the last write is next best.
      const st = fs.statSync(file);
      const born = sqlTime(st.birthtimeMs || st.mtimeMs);
      const owner =
        [...owners].reverse().find((o) => o.createdAt <= born) ?? owners[0];
      owner.files.push(file);
      claimed.add(file);
    }
  }

  return [...sessions.values()].filter((s) => s.files.length > 0);
}

function fresh(file: string, since: number): boolean {
  try {
    return fs.statSync(file).mtimeMs >= since;
  } catch {
    return false;
  }
}

/** A transcript's subagents, each with what kind of agent it was. */
export function subagentFiles(
  transcript: string,
  since: number
): { file: string; type: string; description: string }[] {
  const dir = path.join(transcript.replace(/\.jsonl$/, ""), "subagents");
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const file = path.join(dir, name);
    if (!fresh(file, since)) continue;
    let meta: { agentType?: string; description?: string } = {};
    try {
      meta = JSON.parse(
        fs.readFileSync(file.replace(/\.jsonl$/, ".meta.json"), "utf8")
      );
    } catch {
      // No meta: an older Claude Code. The agent is still counted.
    }
    out.push({
      file,
      type: meta.agentType || "unknown",
      description: scrub(meta.description || ""),
    });
  }
  return out;
}

export interface DbSignals {
  checks: { kind: string; status: string; count: number }[];
  /** Tasks reviewed or CI-checked again and again: commits pushed after review. */
  reviewRounds: {
    session: string;
    reviews: number;
    errors: number;
    blocks: number;
  }[];
  notes: { kind: string; count: number }[];
  asks: { kind: string; count: number }[];
  gateFailures: { gate: string; count: number; sessions: number }[];
  events: { key: string; count: number; hits: number }[];
  idleEvents: number;
  messages: {
    total: number;
    fromOrchestrator: number;
    toTasks: number;
    top: { text: string; count: number; sessions: number }[];
  };
  chatCostUsd: number;
  chatCostBySession: Record<string, number>;
}

/** What AgentOS recorded in the range, from its own tables. */
export function loadSignals(
  db: Database.Database,
  since: number,
  until: number,
  sessionIds: Set<string>
): DbSignals {
  const a = sqlTime(since);
  const b = sqlTime(until);
  const iso = [new Date(since).toISOString(), new Date(until).toISOString()];
  const all = <T>(sql: string, ...params: unknown[]): T[] => {
    try {
      return db.prepare(sql).all(...params) as T[];
    } catch (error) {
      // A table an older database doesn't have yet; any other error (a
      // renamed column) must fail loudly, not read as zero.
      if (/no such table/.test(String(error))) return [];
      throw error;
    }
  };

  const reviewRounds = all<{
    session: string;
    reviews: number;
    errors: number;
    blocks: number;
  }>(
    `SELECT session_id AS session, count(*) AS reviews,
            sum(status = 'error') AS errors, sum(status = 'block') AS blocks
       FROM orchestrator_checks
      WHERE kind = 'review' AND created_at >= ? AND created_at < ?
      GROUP BY session_id HAVING count(*) >= 2 ORDER BY reviews DESC LIMIT 15`,
    a,
    b
  );

  const gateFailures = all<{ session_id: string; gate: string; count: number }>(
    `SELECT session_id, gate, count FROM orchestrator_gate_failures WHERE count > 0`
  ).filter((r) => sessionIds.has(r.session_id));
  const gates = new Map<
    string,
    { gate: string; count: number; sessions: number }
  >();
  for (const r of gateFailures) {
    const g = gates.get(r.gate) ?? { gate: r.gate, count: 0, sessions: 0 };
    g.count += r.count;
    g.sessions++;
    gates.set(r.gate, g);
  }

  const events = all<{
    key: string;
    created_at: string;
    hits: number;
    line: string;
  }>(
    `SELECT key, created_at, hits, line FROM orchestrator_events WHERE created_at >= ? AND created_at < ?`,
    ...iso
  );
  const byKey = new Map<string, { key: string; count: number; hits: number }>();
  let idleEvents = 0;
  for (const ev of events) {
    const key = ev.key.split(":")[0];
    const k = byKey.get(key) ?? { key, count: 0, hits: 0 };
    k.count++;
    k.hits += ev.hits;
    byKey.set(key, k);
    if (/\bidle \d+m\b/.test(ev.line)) idleEvents++;
  }

  const msgs = all<{
    from_id: string | null;
    to_id: string;
    body: string;
    from_role: string | null;
    to_task: number;
  }>(
    `SELECT m.from_id, m.to_id, m.body, f.role AS from_role, (t.task_prompt IS NOT NULL) AS to_task
       FROM bus_messages m
       LEFT JOIN session_rows f ON f.id = m.from_id
       LEFT JOIN session_rows t ON t.id = m.to_id
      WHERE m.created_at >= ? AND m.created_at < ?`,
    a,
    b
  );
  const texts = new Map<string, { count: number; sessions: Set<string> }>();
  let fromOrchestrator = 0;
  let toTasks = 0;
  for (const m of msgs) {
    if (m.from_role === "orchestrator") fromOrchestrator++;
    if (m.to_task) toTasks++;
    if (m.from_role !== "orchestrator") continue;
    const text = normalizeError(m.body).slice(0, 90);
    const t = texts.get(text) ?? { count: 0, sessions: new Set<string>() };
    t.count++;
    t.sessions.add(m.to_id);
    texts.set(text, t);
  }

  const costs = all<{ session_id: string; cost: number }>(
    `SELECT session_id, sum(cost_usd) AS cost FROM chat_turns WHERE at >= ? AND at < ? GROUP BY session_id`,
    since,
    until
  );
  const chatCostBySession: Record<string, number> = {};
  for (const c of costs)
    chatCostBySession[c.session_id] = Math.round(c.cost * 100) / 100;

  return {
    checks: all(
      `SELECT kind, status, count(*) AS count FROM orchestrator_checks
        WHERE created_at >= ? AND created_at < ? GROUP BY kind, status ORDER BY count DESC`,
      a,
      b
    ),
    reviewRounds: reviewRounds.map((r) => ({
      ...r,
      errors: r.errors ?? 0,
      blocks: r.blocks ?? 0,
    })),
    notes: all(
      `SELECT kind, count(*) AS count FROM orchestrator_notes
        WHERE created_at >= ? AND created_at < ? GROUP BY kind ORDER BY count DESC`,
      a,
      b
    ),
    asks: all(
      `SELECT kind, count(*) AS count FROM orchestrator_asks
        WHERE created_at >= ? AND created_at < ? GROUP BY kind ORDER BY count DESC`,
      a,
      b
    ),
    gateFailures: [...gates.values()].sort((x, y) => y.count - x.count),
    events: [...byKey.values()].sort((x, y) => y.hits - x.hits),
    idleEvents,
    messages: {
      total: msgs.length,
      fromOrchestrator,
      toTasks,
      top: [...texts]
        .map(([text, t]) => ({
          text,
          count: t.count,
          sessions: t.sessions.size,
        }))
        .sort((x, y) => y.count - x.count)
        .slice(0, 12),
    },
    chatCostUsd:
      Math.round(costs.reduce((sum, c) => sum + c.cost, 0) * 100) / 100,
    chatCostBySession,
  };
}
