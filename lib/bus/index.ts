/**
 * The agent bus: sessions find each other, message each other and are woken
 * when something arrives. Messages live in SQLite; delivery types a line into
 * the recipient's tmux pane, which works for any agent CLI.
 */

import { db, type Session } from "../db";
import { getProject } from "../projects";
import { statusDetector } from "../status-detector";
import { sendChatConfirmed } from "../chat/runner";
import type { ChatOrigin, PeerMessage } from "../chat/events";
import { sessionRowInfo } from "../session-meta";
import { previousNames } from "../session-names";
import { deliverToPane, type Delivery } from "./delivery";
import { resolveRef, wasNames, type Candidate } from "./resolve";
import { tmuxPane } from "./tmux-pane";
import { hostLink } from "../hosts/remote-api";
import { pauseHoldOf, pausedNote } from "../tasks/pause-hold";
import { relayToHeldTask } from "../tasks/held-remote";
import {
  assertTakesMessages,
  findQueuedTarget,
  heldQueuedNote,
  type QueuedTarget,
} from "../tasks/queue-held";
import { heldOrchestrator, heldTarget } from "./held-reply";
import { HUMAN, overRateLimit, wakeLine, type BusMessageView } from "./format";

export * from "./format";
export type { Delivery } from "./delivery";

export interface Peer {
  id: string;
  name: string;
  // Names it had before renames, newest first.
  was: string[];
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

const sessionById = (id: string | null | undefined) =>
  id
    ? (db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as
        | Session
        | undefined)
    : undefined;

// `callerId`: the asking session. A task its orchestrator moved here also
// sees that orchestrator, which it can message though it runs elsewhere.
export async function listPeers(callerId?: string): Promise<Peer[]> {
  await statusDetector.refreshCache();
  const sessions = liveSessions();
  const named = candidates(sessions);
  const orchestrator = heldOrchestrator(sessionById(callerId));
  const listed = await Promise.all(
    sessions.map(async (s, i) => {
      const status = statusDetector.sessionExists(s.tmux_name)
        ? await statusDetector.getStatus(s.tmux_name)
        : "dead";
      const info = sessionRowInfo(status, statusDetector.titleFor(s.tmux_name));
      return {
        id: s.id,
        name: s.name,
        was: wasNames(named[i]),
        projectName: named[i].projectName,
        tmuxName: s.tmux_name,
        hostId: s.host_id,
        running: info.running,
        doing: info.subtitle,
      };
    })
  );
  if (!orchestrator) return listed;
  return [
    ...listed,
    {
      id: orchestrator.id,
      name: orchestrator.name,
      was: [],
      projectName: null,
      tmuxName: "",
      hostId: "remote",
      running: true,
      doing: `your orchestrator, on ${orchestrator.heldFrom}`,
    },
  ];
}

// The orchestrator a held caller's ref names, if it names it.
export function resolveHeldOrchestrator(callerId: string, ref: string) {
  return heldTarget(sessionById(callerId), ref);
}

// A live session by name, old name, project/name, id or id prefix. The note
// says when the name meant something other than its current owner.
export function resolveTarget(ref: string): {
  session: Session;
  note?: string;
} {
  const found = tryResolveTarget(ref);
  if (!found.ok) throw new Error(found.error);
  return found;
}

function tryResolveTarget(
  ref: string
):
  | { ok: true; session: Session; note?: string }
  | { ok: false; none: boolean; error: string } {
  const sessions = liveSessions();
  const r = resolveRef(ref, candidates(sessions));
  if (!r.ok)
    return {
      ok: false,
      none: r.reason === "none",
      error: r.reason === "none" ? `${r.error}. Run: aos peers` : r.error,
    };
  return {
    ok: true,
    session: sessions.find((s) => s.id === r.id)!,
    note: r.note,
  };
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
export async function deliver(
  to: Session,
  line: string,
  from: {
    name: string;
    peer?: PeerMessage;
    origin?: ChatOrigin;
    // The stored message's id, which a relayed one is keyed by.
    messageId?: number;
  }
): Promise<Delivery> {
  // A task this machine's orchestrator moved to a linked machine: that
  // machine's AgentOS delivers it, labelled as the orchestrator's (held.ts).
  if (to.task_prompt && to.started_by && hostLink(to.host_id))
    return relayToHeldTask(to, line, from.name, from.messageId);
  // A linked machine's own session: an agent's message would reach it as
  // the user's (see runner.ts), so none is relayed yet.
  if (to.peer_mirror && !to.task_prompt)
    return {
      state: "failed",
      why: "it runs on a linked machine: message it from there",
    };
  // Chat sessions get the message as their next prompt, tagged with who
  // sent it so chat shows it as theirs.
  if (to.view === "chat") {
    try {
      const state = await sendChatConfirmed(to.id, {
        text: line,
        from: from.name,
        peer: from.peer,
        origin: from.origin,
        // Nobody is at the composer to choose: a stale chat is compacted
        // first (lib/chat/stale).
        compact: "auto",
      });
      return { state };
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      return { state: "failed", why };
    }
  }
  // A paused terminal has no agent: the message waits for the resume prompt.
  const paused = pauseHoldOf(to.id);
  if (paused) {
    if (from.messageId)
      db.prepare(`UPDATE bus_messages SET held_pause_id = ? WHERE id = ?`).run(
        paused.pauseId,
        from.messageId
      );
    return { state: "queued" };
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
  // Who it's from when no session sent it (a schedule); the user otherwise.
  fromLabel?: string;
  // How chat shows it when no session sent it (fromLabel is what the
  // agent reads). The user's own message, sent from the UI, has none.
  origin?: ChatOrigin;
  // What the recipient's agent reads, whole, in place of the wake line.
  // It's never left unread for `aos inbox` to show in another form; a
  // failed one is the sender's to retry.
  line?: string;
  // A message pulled from a linked machine, by its key there: one already
  // stored is not stored or delivered again.
  relayKey?: string;
}): Promise<{
  message: BusMessageView;
  delivery: Delivery;
  note?: string;
  // The task it was held for, when that task is still in the start queue.
  heldForQueued?: boolean;
}> {
  const body = opts.body.trim();
  if (!body) throw new Error("Message is empty");
  const from = sessionById(opts.fromId);
  if (opts.fromId && !from) throw new Error("Unknown sender session");
  // A held task's message to its orchestrator is kept for the holder to pull.
  const held = heldTarget(from, opts.to);
  if (from && held) return storeForHolder(from, held, body);
  const target = tryResolveTarget(opts.to);
  if (!target.ok) {
    // A task still in the start queue has no session yet: hold it.
    const queued = target.none ? findQueuedTarget(opts.to) : null;
    if (!queued) throw new Error(target.error);
    return storeForQueued(from, opts.fromLabel, queued, body, opts.relayKey);
  }
  const { session: to, note } = target;
  if (from && from.id === to.id)
    throw new Error("A session can't message itself");
  if (from && overRateLimit(pairTimestamps(from.id, to.id))) {
    throw new Error(
      `Too many messages between ${from.name} and ${to.name}; wait a few minutes`
    );
  }
  if (opts.relayKey) {
    const seen = db
      .prepare(`SELECT id FROM bus_messages WHERE relay_key = ?`)
      .get(opts.relayKey) as { id: number } | undefined;
    if (seen)
      return {
        message: toView(
          db.prepare(`${SELECT} WHERE m.id = ?`).get(seen.id) as Row
        ),
        delivery: { state: "delivered" },
      };
  }

  const fromName = from?.name ?? opts.fromLabel ?? HUMAN;
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO bus_messages (from_id, from_name, to_id, to_name, body, relay_key) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      from?.id ?? null,
      fromName,
      to.id,
      to.name,
      body,
      opts.relayKey ?? null
    );
  const id = Number(lastInsertRowid);

  await statusDetector.refreshCache();
  const delivery = await deliver(
    to,
    opts.line ?? wakeLine({ fromName, fromId: from?.id ?? null, body }),
    {
      name: fromName,
      messageId: id,
      peer: from ? { sessionId: from.id, body } : undefined,
      origin: from
        ? { kind: "peer", label: from.name, sessionId: from.id }
        : opts.origin,
    }
  );
  // A message held for a paused terminal isn't delivered until it resumes.
  const hold = pauseHoldOf(to.id);
  const parked = !!hold && to.view !== "chat";
  if (delivery.state !== "failed" && !parked) {
    db.prepare(
      `UPDATE bus_messages SET delivered_at = datetime('now') WHERE id = ?`
    ).run(id);
  }
  if (opts.line)
    db.prepare(
      `UPDATE bus_messages SET read_at = datetime('now') WHERE id = ?`
    ).run(id);
  const message = toView(db.prepare(`${SELECT} WHERE m.id = ?`).get(id) as Row);
  const heldNote = hold ? pausedNote(to.name, hold) : null;
  return {
    message,
    delivery,
    note: [note, heldNote].filter(Boolean).join("; ") || undefined,
  };
}

function storeForHolder(
  from: Session,
  to: { id: string; name: string; heldFrom: string },
  body: string
) {
  if (overRateLimit(pairTimestamps(from.id, to.id)))
    throw new Error(
      `Too many messages between ${from.name} and ${to.name}; wait a few minutes`
    );
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO bus_messages (from_id, from_name, to_id, to_name, body, relay_state)
       VALUES (?, ?, ?, ?, ?, 'pending')`
    )
    .run(from.id, from.name, to.id, to.name, body);
  const message = toView(
    db.prepare(`${SELECT} WHERE m.id = ?`).get(Number(lastInsertRowid)) as Row
  );
  return {
    message,
    delivery: { state: "queued" as const },
    note: `${to.name} runs on ${to.heldFrom}: it gets this when that machine next checks in, within a few seconds`,
  };
}

// A message for a task that hasn't started: kept with the queued task and
// delivered in its first prompt. A schedule's `line` is only a wake line;
// the body is what's held.
function storeForQueued(
  from: Session | undefined,
  fromLabel: string | undefined,
  to: QueuedTarget,
  body: string,
  relayKey?: string
) {
  assertTakesMessages(to);
  if (from && overRateLimit(pairTimestamps(from.id, to.id)))
    throw new Error(
      `Too many messages between ${from.name} and ${to.name}; wait a few minutes`
    );
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO bus_messages (from_id, from_name, to_id, to_name, body, relay_key, held_queued)
       VALUES (?, ?, ?, ?, ?, ?, 1)`
    )
    .run(
      from?.id ?? null,
      from?.name ?? fromLabel ?? HUMAN,
      to.id,
      to.name,
      body,
      relayKey ?? null
    );
  const message = toView(
    db.prepare(`${SELECT} WHERE m.id = ?`).get(Number(lastInsertRowid)) as Row
  );
  return {
    message,
    delivery: { state: "queued" as const },
    note: heldQueuedNote(to.name),
    heldForQueued: true,
  };
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
