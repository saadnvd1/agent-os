/**
 * Fresh starts: a chat whose context passes a threshold ends its agent's
 * conversation at the next turn boundary, and the next worker starts a new
 * one with the brief (lib/chat/worker/host). An orchestrator is fed events
 * nonstop, never idles and can't compact itself, so it's on for it by
 * default: its state is in the database and its brief carries it
 * (lib/orchestrator/digest). A task keeps its progress only in its
 * conversation and its branch, so for tasks it's off unless switched on.
 * App-wide, in Settings → Workspaces, with the two sizes at which chats and
 * tasks compact: mid-turn (Claude Code itself, high so a job keeps its
 * files) and between turns (lib/chat/stale, earlier, nothing in flight).
 */

import { db } from "../db";
import { effectiveModels } from "../models/config";
import { type ModelRole } from "../models/roles";
import { sessionRole } from "../models/session-role";
import { MAX_REFRESH_TOKENS, MIN_REFRESH_TOKENS } from "./refresh-limits";

export const ORCHESTRATOR_KEY = "orchestrator.refresh_tokens";
export const TASK_KEY = "chat.task_refresh_tokens";
// Named for what it first did: compact chats idle past their cache.
export const COMPACT_KEY = "chat.stale_compact_tokens";
export const DEFAULT_ORCHESTRATOR_TOKENS = 200_000;
export const DEFAULT_COMPACT_TOKENS = 150_000;
// Claude Code's own mid-turn auto-compact window: high, because a summary
// mid-job costs the agent its files and its place.
export const AUTO_COMPACT_KEY = "chat.auto_compact_tokens";
export const DEFAULT_AUTO_COMPACT_TOKENS = 300_000;
// The same window for a person's own (interactive) sessions, which run long
// on the biggest model. 300k (DEFAULT_AUTO_COMPACT_TOKENS) was its value
// before it had its own setting: set it back to restore that.
export const INTERACTIVE_AUTO_COMPACT_KEY =
  "chat.interactive_auto_compact_tokens";
export const DEFAULT_INTERACTIVE_AUTO_COMPACT_TOKENS = 300_000;
export { MIN_REFRESH_TOKENS, MAX_REFRESH_TOKENS } from "./refresh-limits";

export interface RefreshSettings {
  // Context tokens at which a conversation starts over; 0 is off.
  orchestratorTokens: number;
  taskTokens: number;
  // Between turns: a chat over this size (or idle past its cache) is
  // compacted before its next message. 0 is off.
  compactTokens: number;
  // Mid-turn: Claude Code's own auto-compact window for a chat's or task's
  // agent. 0 is off.
  autoCompactTokens: number;
  // The same, for interactive sessions. 0 is off.
  interactiveAutoCompactTokens: number;
}

function read(key: string, fallback: number): number {
  const row = db
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  const n = row ? Number(row.value) : fallback;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function refreshSettings(): RefreshSettings {
  return {
    orchestratorTokens: read(ORCHESTRATOR_KEY, DEFAULT_ORCHESTRATOR_TOKENS),
    taskTokens: read(TASK_KEY, 0),
    compactTokens: read(COMPACT_KEY, DEFAULT_COMPACT_TOKENS),
    autoCompactTokens: read(AUTO_COMPACT_KEY, DEFAULT_AUTO_COMPACT_TOKENS),
    interactiveAutoCompactTokens: read(
      INTERACTIVE_AUTO_COMPACT_KEY,
      DEFAULT_INTERACTIVE_AUTO_COMPACT_TOKENS
    ),
  };
}

// A threshold, checked: 0 (off) or a whole number in range. Throws a plain
// message otherwise.
export function checkRefreshTokens(value: unknown): number {
  if (value === 0) return 0;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < MIN_REFRESH_TOKENS ||
    value > MAX_REFRESH_TOKENS
  )
    throw new Error(
      `A context threshold is off or between ${MIN_REFRESH_TOKENS / 1000}k and ${MAX_REFRESH_TOKENS / 1000}k tokens`
    );
  return value;
}

export function setRefreshSettings(input: Partial<RefreshSettings>): void {
  const put = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  );
  const checked: [string, number][] = [];
  if (input.orchestratorTokens !== undefined)
    checked.push([
      ORCHESTRATOR_KEY,
      checkRefreshTokens(input.orchestratorTokens),
    ]);
  if (input.taskTokens !== undefined)
    checked.push([TASK_KEY, checkRefreshTokens(input.taskTokens)]);
  if (input.compactTokens !== undefined)
    checked.push([COMPACT_KEY, checkRefreshTokens(input.compactTokens)]);
  if (input.autoCompactTokens !== undefined)
    checked.push([
      AUTO_COMPACT_KEY,
      checkRefreshTokens(input.autoCompactTokens),
    ]);
  if (input.interactiveAutoCompactTokens !== undefined)
    checked.push([
      INTERACTIVE_AUTO_COMPACT_KEY,
      checkRefreshTokens(input.interactiveAutoCompactTokens),
    ]);
  db.transaction(() => {
    for (const [key, n] of checked) put.run(key, String(n));
  })();
}

// Claude Code's own auto-compact window, in plain tokens (it reads "150k"
// as 150 and clamps anything under 100k up to it).
export const AUTO_COMPACT_ENV = "CLAUDE_CODE_AUTO_COMPACT_WINDOW";
const AUTO_COMPACT_MIN = 100_000;
// Claude Code turns tool search off for a host that isn't Anthropic's, so
// every MCP and deferred tool schema rides in each prompt: measured on
// DeepSeek, the first call after a compaction is ~100k tokens against ~53k
// on Claude. A window measured from zero left it 15-30k of room, so it
// compacted every couple of minutes. Providers get that extra on top.
export const PROVIDER_BASE_TOKENS = 60_000;

// The compact threshold for a session on this provider (null: Anthropic).
export function compactThreshold(
  tokens: number,
  provider: string | null | undefined
): number {
  if (tokens <= 0 || !provider) return tokens;
  const window = effectiveModels().providers.find(
    (p) => p.id === provider
  )?.contextWindow;
  const wanted = tokens + PROVIDER_BASE_TOKENS;
  return window ? Math.min(wanted, window) : wanted;
}

// Claude Code's own auto-compact window for an agent, before the provider's
// adjustment; 0 is none. A person's session has its own window, in a chat
// or a terminal alike (a terminal can't be compacted between turns, so this
// is the only compaction it gets). An orchestrator starts over from its
// brief at its own threshold instead, since a summary would carry what it
// read from tasks and CI without its untrusted fence.
export function autoCompactTokensFor(
  role: ModelRole,
  s: RefreshSettings
): number {
  if (role === "orchestrator") return 0;
  return role === "interactive"
    ? s.interactiveAutoCompactTokens
    : s.autoCompactTokens;
}

// What an agent is launched with so it compacts itself at the threshold.
// Nothing when it's off, so a window set in the user's own environment
// still applies.
export function autoCompactEnv(sessionId: string): Record<string, string> {
  const row = db
    .prepare(
      `SELECT role, task_status, plan_phase, started_by, model_provider
       FROM session_rows WHERE id = ?`
    )
    .get(sessionId) as
    | {
        role: string | null;
        task_status: string | null;
        plan_phase: string | null;
        started_by: string | null;
        model_provider: string | null;
      }
    | undefined;
  if (!row) return {};
  const tokens = autoCompactTokensFor(sessionRole(row), refreshSettings());
  if (tokens <= 0) return {};
  const window = compactThreshold(
    Math.max(AUTO_COMPACT_MIN, tokens),
    row.model_provider
  );
  return { [AUTO_COMPACT_ENV]: String(window) };
}

const k = (tokens: number) => `${Math.round(tokens / 1000)}k`;

// Recorded as the size a conversation ended at when the reader asked for it.
export const REQUESTED_FRESH = -1;

// The agent's conversation is let go in the database: the next worker
// starts a new one with the brief and the permissions the server has then.
// `tokens` is the size it ended at, or REQUESTED_FRESH.
export function releaseConversation(sessionId: string, tokens: number): void {
  db.prepare(
    `UPDATE sessions SET claude_session_id = NULL, chat_resume_at = NULL,
       chat_suggestion = NULL, chat_context = NULL, chat_restarted = 0,
       chat_refreshed = ? WHERE id = ?`
  ).run(tokens, sessionId);
}

// What the agent reads ahead of its first message in the new conversation.
export function refreshedNote(role: "orchestrator" | "task", tokens: number) {
  if (tokens === REQUESTED_FRESH)
    return role === "orchestrator"
      ? `(AgentOS started you on a fresh conversation at the user's request. Your brief and "Where things stand" are current; carry on from them.)`
      : `(AgentOS started you on a fresh conversation at the user's request. Your brief is above; check git status, git log and your PR to see how far you got, then carry on.)`;
  return role === "orchestrator"
    ? `(AgentOS started you on a fresh conversation: the last one passed ${k(tokens)} tokens of context. Your brief and "Where things stand" are current; carry on from them.)`
    : `(AgentOS started you on a fresh conversation: the last one passed ${k(tokens)} tokens of context. Your brief is above; check git status, git log and your PR to see how far you got, then carry on.)`;
}
