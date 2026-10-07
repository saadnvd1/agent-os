/**
 * The agent bus: sessions find each other, message each other and are woken
 * when something arrives. Messages live in SQLite; delivery types a line into
 * the recipient's tmux pane, which works for any agent CLI.
 */

import { db, type Session } from "../db";
import { getProject } from "../projects";
import { statusDetector } from "../status-detector";
import { sendChatConfirmed } from "../chat/runner";
import { sessionRowInfo } from "../session-meta";
import { previousNames } from "../session-names";
import { deliverToPane, type Delivery } from "./delivery";
import { resolveRef, wasName, type Candidate } from "./resolve";
import { tmuxPane } from "./tmux-pane";
import { HUMAN, overRateLimit, wakeLine, type BusMessageView } from "./format";

export * from "./format";
export type { Delivery } from "./delivery";

export interface Peer {
  id: string;
  name: string;
  // The latest name it had before a rename.
  was: string | null;
  projectName: string | null;
  tmuxName: string;
  hostId: string;
  running: boolean;
  doing: string | null;
}

function liveSessions(): Session[] {
  return db
    .prepare(
      `SELECT * FROM sessions WHERE (task_status IS NULL OR task_status = 'running')
         AND archived_at IS NULL
       ORDER BY updated_at DESC`
    )
    .all() as Session[];
}

function candidates(sessions: Session[]): Candidate[] {
  const old = previousNames();
  return sessions.map((s) => ({
    id: s.id,
    name: s.name,
    projectName: s.project_id ? (getProject(s.project_id)?.name ?? null) : null,
    tmuxName: s.tmux_name,
    previousNames: old.get(s.id) ?? [],
  }));
}

export async function listPeers(): Promise<Peer[]> {
  await statusDetector.refreshCache();
  const sessions = liveSessions();
  const named = candidates(sessions);
  return Promise.all(
    sessions.map(async (s, i) => {
      const status = statusDetector.sessionExists(s.tmux_name)
        ? await statusDetector.getStatus(s.tmux_name)
        : "dead";
      const info = sessionRowInfo(status, statusDetector.titleFor(s.tmux_name));
      return {
        id: s.id,
        name: s.name,
        was: wasName(named[i]),
        projectName: named[i].projectName,
        tmuxName: s.tmux_name,
        hostId: s.host_id,
        running: info.running,
        doing: info.subtitle,
      };
    })
  );
}

// A live session by name, old name, project/name, id or id prefix. The note
// says when the name meant something other than its current owner.
export function resolveTarget(ref: string): {
  session: Session;
  note?: string;
} {
  const sessions = liveSessions();
  const r = resolveRef(ref, candidates(sessions));
  if (!r.ok)
    throw new Error(
      r.reason === "none" ? `${r.error}. Run: aos peers` : r.error
    );
  return { session: sessions.find((s) => s.id === r.id)!, note: r.note };
}

export function resolveSession(ref: string): Session {
  return resolveTarget(ref).session;
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

// Messages are kept by id; names shown are the sessions' names now, the
// stored ones only for a session that's gone.
const SELECT = `SELECT m.id, m.from_id, m.to_id, m.body, m.created_at, m.read_at,
    CASE WHEN m.from_id IS NULL THEN m.from_name
         ELSE COALESCE(f.name, m.from_name) END AS from_name,
    COALESCE(t.name, m.to_name) AS to_name
  FROM bus_messages m
  LEFT JOIN sessions f ON f.id = m.from_id
  LEFT JOIN sessions t ON t.id = m.to_id`;

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

// Hands the message to the recipient: a chat session's worker, or typed
// into a terminal's pane and checked that it went in.
async function deliver(
  to: Session,
  line: string,
  from: { name: string; id: string | null }
): Promise<Delivery> {
  if (to.view === "chat") {
    try {
      const state = await sendChatConfirmed(to.id, {
        text: line,
        from: from.name,
        fromId: from.id ?? undefined,
      });
      return { state };
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      return { state: "failed", why };
    }
  }
  if (!statusDetector.sessionExists(to.tmux_name))
    return { state: "failed", why: "its terminal isn't running" };
  try {
    return await deliverToPane(tmuxPane(to.host_id, to.tmux_name), line);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return { state: "failed", why: `tmux: ${why.split("\n")[0]}` };
  }
}

export async function sendMessage(opts: {
  fromId: string | null;
  to: string;
  body: string;
}): Promise<{ message: BusMessageView; delivery: Delivery; note?: string }> {
  const body = opts.body.trim();
  if (!body) throw new Error("Message is empty");
  const { session: to, note } = resolveTarget(opts.to);
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
  const delivery = await deliver(
    to,
    wakeLine({ fromName, fromId: from?.id ?? null, body }),
    { name: fromName, id: from?.id ?? null }
  );
  if (delivery.state !== "failed") {
    db.prepare(
      `UPDATE bus_messages SET delivered_at = datetime('now') WHERE id = ?`
    ).run(id);
  }
  const message = toView(db.prepare(`${SELECT} WHERE m.id = ?`).get(id) as Row);
  return { message, delivery, note };
}

// Unread messages for a session, marked read as they're returned.
export function readInbox(sessionId: string): BusMessageView[] {
  const rows = db
    .prepare(`${SELECT} WHERE m.to_id = ? AND m.read_at IS NULL ORDER BY m.id`)
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
          `${SELECT} WHERE m.from_id = ? OR m.to_id = ? ORDER BY m.id DESC LIMIT ?`
        )
        .all(opts.sessionId, opts.sessionId, limit) as Row[])
    : (db.prepare(`${SELECT} ORDER BY m.id DESC LIMIT ?`).all(limit) as Row[]);
  return rows.reverse().map(toView);
}
