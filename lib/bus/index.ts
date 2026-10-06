/**
 * The agent bus: sessions find each other, message each other and are woken
 * when something arrives. Messages live in SQLite; delivery types a line into
 * the recipient's tmux pane, which works for any agent CLI.
 */

import { db, type Session } from "../db";
import { getProject } from "../projects";
import { hostExec } from "../hosts";
import { shellQuote } from "../hosts/ssh";
import { statusDetector } from "../status-detector";
import { sessionRowInfo } from "../session-meta";
import {
  HUMAN,
  matchesRef,
  overRateLimit,
  wakeLine,
  type BusMessageView,
} from "./format";

export * from "./format";

export interface Peer {
  id: string;
  name: string;
  projectName: string | null;
  tmuxName: string;
  hostId: string;
  running: boolean;
  doing: string | null;
}

function liveSessions(): Session[] {
  return db
    .prepare(
      `SELECT * FROM sessions WHERE task_status IS NULL OR task_status = 'running'
       ORDER BY updated_at DESC`
    )
    .all() as Session[];
}

export async function listPeers(): Promise<Peer[]> {
  await statusDetector.refreshCache();
  return Promise.all(
    liveSessions().map(async (s) => {
      const status = statusDetector.sessionExists(s.tmux_name)
        ? await statusDetector.getStatus(s.tmux_name)
        : "dead";
      const info = sessionRowInfo(status, statusDetector.titleFor(s.tmux_name));
      return {
        id: s.id,
        name: s.name,
        projectName: s.project_id
          ? (getProject(s.project_id)?.name ?? null)
          : null,
        tmuxName: s.tmux_name,
        hostId: s.host_id,
        running: info.running,
        doing: info.subtitle,
      };
    })
  );
}

export function resolveSession(ref: string): Session {
  const matches = liveSessions().filter((s) =>
    matchesRef(ref, {
      id: s.id,
      name: s.name,
      projectName: s.project_id
        ? (getProject(s.project_id)?.name ?? null)
        : null,
      tmuxName: s.tmux_name,
    })
  );
  if (matches.length === 0)
    throw new Error(`No session called "${ref}". Run: aos peers`);
  if (matches.length > 1) {
    throw new Error(
      `"${ref}" matches ${matches.length} sessions; use project/name or the id`
    );
  }
  return matches[0];
}

type Row = {
  id: number;
  from_id: string | null;
  from_name: string;
  to_id: string;
  to_name: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

const toView = (r: Row): BusMessageView => ({
  id: r.id,
  fromId: r.from_id,
  fromName: r.from_name,
  toId: r.to_id,
  toName: r.to_name,
  body: r.body,
  createdAt: r.created_at,
  readAt: r.read_at,
});

function pairTimestamps(a: string | null, b: string): number[] {
  const rows = db
    .prepare(
      `SELECT created_at FROM bus_messages
       WHERE (from_id IS ? AND to_id = ?) OR (from_id = ? AND to_id IS ?)
       ORDER BY id DESC LIMIT 100`
    )
    .all(a, b, b, a) as { created_at: string }[];
  return rows.map((r) =>
    new Date(`${r.created_at.replace(" ", "T")}Z`).getTime()
  );
}

// Type the message into the recipient's pane. Claude Code queues it if busy.
async function deliver(to: Session, line: string): Promise<boolean> {
  if (!statusDetector.sessionExists(to.tmux_name)) return false;
  const target = shellQuote(`=${to.tmux_name}:`);
  try {
    await hostExec(
      to.host_id,
      `tmux send-keys -t ${target} -l ${shellQuote(line)} && tmux send-keys -t ${target} Enter`
    );
    return true;
  } catch {
    return false;
  }
}

export async function sendMessage(opts: {
  fromId: string | null;
  to: string;
  body: string;
}): Promise<BusMessageView> {
  const body = opts.body.trim();
  if (!body) throw new Error("Message is empty");
  const to = resolveSession(opts.to);
  const from = opts.fromId
    ? (db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(opts.fromId) as
        | Session
        | undefined)
    : undefined;
  if (opts.fromId && !from) throw new Error("Unknown sender session");
  if (from && from.id === to.id)
    throw new Error("A session can't message itself");
  if (from && overRateLimit(pairTimestamps(from.id, to.id))) {
    throw new Error(
      `Too many messages between ${from.name} and ${to.name}; wait a few minutes`
    );
  }

  const fromName = from?.name ?? HUMAN;
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO bus_messages (from_id, from_name, to_id, to_name, body) VALUES (?, ?, ?, ?, ?)`
    )
    .run(from?.id ?? null, fromName, to.id, to.name, body);
  const id = Number(lastInsertRowid);

  await statusDetector.refreshCache();
  if (
    await deliver(to, wakeLine({ fromName, fromId: from?.id ?? null, body }))
  ) {
    db.prepare(
      `UPDATE bus_messages SET delivered_at = datetime('now') WHERE id = ?`
    ).run(id);
  }
  return toView(
    db.prepare(`SELECT * FROM bus_messages WHERE id = ?`).get(id) as Row
  );
}

// Unread messages for a session, marked read as they're returned.
export function readInbox(sessionId: string): BusMessageView[] {
  const rows = db
    .prepare(
      `SELECT * FROM bus_messages WHERE to_id = ? AND read_at IS NULL ORDER BY id`
    )
    .all(sessionId) as Row[];
  db.prepare(
    `UPDATE bus_messages SET read_at = datetime('now') WHERE to_id = ? AND read_at IS NULL`
  ).run(sessionId);
  return rows.map(toView);
}

export function listMessages(
  opts: { sessionId?: string; limit?: number } = {}
): BusMessageView[] {
  const limit = Math.min(opts.limit ?? 200, 500);
  const rows = opts.sessionId
    ? (db
        .prepare(
          `SELECT * FROM bus_messages WHERE from_id = ? OR to_id = ? ORDER BY id DESC LIMIT ?`
        )
        .all(opts.sessionId, opts.sessionId, limit) as Row[])
    : (db
        .prepare(`SELECT * FROM bus_messages ORDER BY id DESC LIMIT ?`)
        .all(limit) as Row[]);
  return rows.reverse().map(toView);
}
