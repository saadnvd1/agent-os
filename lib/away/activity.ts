/**
 * Real activity, for Away mode: when a session last had a user or agent
 * turn. Not `updated_at` (status polls bump it) and not tmux's activity
 * clock where a better one exists, and never a turn Away mode itself
 * started (an away line or digest an orchestrator was sent). The window
 * past which a session counts as left alone is app-wide, in Settings →
 * Workspaces.
 */

import fs from "fs";
import { db, type Session } from "../db";
import type { ChatOrigin } from "../chat/events";
import { chatState } from "../chat/runner";
import { runningWorkers } from "../chat/worker/client";
import { statusDetector } from "../status-detector";
import { expandHome } from "../tasks/session";
import { isClaudeSessionId, transcriptPath } from "../tasks/transcript";

import {
  DEFAULT_WINDOW_MINUTES,
  MAX_WINDOW_MINUTES,
  MIN_WINDOW_MINUTES,
} from "./window-limits";

export const WINDOW_KEY = "away.window_minutes";

export function awayWindowMinutes(): number {
  const row = db
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(WINDOW_KEY) as { value: string } | undefined;
  const n = row ? Number(row.value) : DEFAULT_WINDOW_MINUTES;
  return Number.isInteger(n) &&
    n >= MIN_WINDOW_MINUTES &&
    n <= MAX_WINDOW_MINUTES
    ? n
    : DEFAULT_WINDOW_MINUTES;
}

export const awayWindowMs = () => awayWindowMinutes() * 60_000;

export function setAwayWindowMinutes(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < MIN_WINDOW_MINUTES ||
    value > MAX_WINDOW_MINUTES
  )
    throw new Error(
      `The window is a whole number of minutes from ${MIN_WINDOW_MINUTES} to ${MAX_WINDOW_MINUTES}`
    );
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(WINDOW_KEY, String(value));
  return value;
}

// Kinds a turn writes; notes, errors, compactions and MCP listings aren't
// anyone working.
const TURN_KINDS = new Set([
  "user",
  "assistant",
  "reasoning",
  "tool",
  "todos",
  "plan",
  "artifact",
  "turn_end",
]);
const SCAN = 200;

interface Item {
  kind?: string;
  createdAt?: number;
  origin?: ChatOrigin;
}

// Newest first: a turn's items come before the message that started it.
// A turn Away mode started doesn't count; one an event, a peer or a
// schedule started counts from its first reply, not from the message.
export function lastChatTurn(items: Item[]): number {
  let reply = 0;
  for (const item of items) {
    if (!item.kind || !TURN_KINDS.has(item.kind)) continue;
    const at = item.createdAt ?? 0;
    if (item.kind !== "user") {
      reply = Math.max(reply, at);
      continue;
    }
    const origin = item.origin;
    if (origin?.away) {
      reply = 0;
      continue;
    }
    // Typed by the reader, or the reader's own decision.
    if (!origin || origin.kind === "decision") return Math.max(reply, at);
    if (reply) return reply;
  }
  return reply;
}

function chatTurn(sessionId: string): number {
  const rows = db
    .prepare(
      `SELECT data FROM chat_items WHERE session_id = ? ORDER BY seq DESC LIMIT ?`
    )
    .all(sessionId, SCAN) as { data: string }[];
  return lastChatTurn(
    rows.map((r) => {
      try {
        return JSON.parse(r.data) as Item;
      } catch {
        return {};
      }
    })
  );
}

// How recently Saad must have messaged an orchestrator for turning Away on
// to tell it.
export const SAAD_MESSAGE_WINDOW_MS = 24 * 60 * 60_000;

// When Saad last typed to a chat himself: a user item with no origin, so
// not an event, a peer, a schedule or AgentOS. 0 when he never has.
function saadMessageAt(sessionId: string): number {
  const row = db
    .prepare(
      `SELECT json_extract(data, '$.createdAt') AS at FROM chat_items
       WHERE session_id = ? AND kind = 'user'
         AND json_extract(data, '$.origin') IS NULL
       ORDER BY seq DESC LIMIT 1`
    )
    .get(sessionId) as { at: number | null } | undefined;
  return row?.at ?? 0;
}

// Whether Saad has been talking to this session lately. A terminal keeps
// no record of who typed, so its last turn stands in.
export function saadMessagedRecently(s: Session, now = Date.now()): boolean {
  const at = s.view === "chat" ? saadMessageAt(s.id) : terminalTurn(s);
  return at > 0 && now - at <= SAAD_MESSAGE_WINDOW_MS;
}

// A terminal's Claude conversation file is written on every turn and on
// nothing else; other agents fall back to tmux's output clock, which a
// status poll (capture-pane) doesn't move.
function terminalTurn(s: Session): number {
  if (s.claude_session_id && isClaudeSessionId(s.claude_session_id)) {
    try {
      const cwd = expandHome(s.worktree_path || s.working_directory);
      return fs.statSync(transcriptPath(cwd, s.claude_session_id)).mtimeMs;
    } catch {
      // No file here: fall through.
    }
  }
  return (
    statusDetector.getTimestamp(s.tmux_name, s.host_id || undefined) * 1000
  );
}

export function lastTurnAt(s: Session): number {
  return s.view === "chat" ? chatTurn(s.id) : terminalTurn(s);
}

// Whether a chat's agent is up: a worker that went idle long enough exits,
// and a message would start it again and re-read the whole conversation.
// A terminal's is its tmux session (facts say "dead" when it's gone).
export function agentLive(s: Session): boolean {
  if (s.view !== "chat")
    return statusDetector.sessionExists(s.tmux_name, s.host_id || undefined);
  return chatState(s.id) !== null || runningWorkers().includes(s.id);
}
