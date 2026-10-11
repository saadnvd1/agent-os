/**
 * Fresh starts: a chat whose context passes a threshold ends its agent's
 * conversation at the next turn boundary, and the next worker starts a new
 * one with the brief (lib/chat/worker/host). An orchestrator is fed events
 * nonstop, never idles and can't compact itself, so it's on for it by
 * default: its state is in the database and its brief carries it
 * (lib/orchestrator/digest). A task keeps its progress only in its
 * conversation and its branch, so for tasks it's off unless switched on.
 * App-wide, in Settings → Workspaces, with the size at which chats and
 * tasks compact (lib/chat/stale).
 */

import { db } from "../db";
import { MAX_REFRESH_TOKENS, MIN_REFRESH_TOKENS } from "./refresh-limits";

export const ORCHESTRATOR_KEY = "orchestrator.refresh_tokens";
export const TASK_KEY = "chat.task_refresh_tokens";
// Named for what it first did: compact chats idle past their cache.
export const COMPACT_KEY = "chat.stale_compact_tokens";
export const DEFAULT_ORCHESTRATOR_TOKENS = 200_000;
export const DEFAULT_COMPACT_TOKENS = 150_000;
export { MIN_REFRESH_TOKENS, MAX_REFRESH_TOKENS } from "./refresh-limits";

export interface RefreshSettings {
  // Context tokens at which a conversation starts over; 0 is off.
  orchestratorTokens: number;
  taskTokens: number;
  // Context tokens at which a chat's or task's agent compacts: Claude
  // Code's own auto-compact window, and between turns a chat over it (or
  // idle past its cache) is compacted before the next message. 0 is off.
  compactTokens: number;
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
  db.transaction(() => {
    for (const [key, n] of checked) put.run(key, String(n));
  })();
}

// Claude Code's own auto-compact window, in plain tokens (it reads "150k"
// as 150 and clamps anything under 100k up to it).
export const AUTO_COMPACT_ENV = "CLAUDE_CODE_AUTO_COMPACT_WINDOW";
const AUTO_COMPACT_MIN = 100_000;

// What an agent is launched with so it compacts itself at the threshold.
// Not an orchestrator: it starts over from its brief at its own threshold
// instead, since a summary would carry what it read from tasks and CI
// without its untrusted fence. Nothing when it's off, so a window set in
// the user's own environment still applies.
export function autoCompactEnv(sessionId: string): Record<string, string> {
  const row = db
    .prepare(`SELECT role FROM sessions WHERE id = ?`)
    .get(sessionId) as { role: string | null } | undefined;
  const tokens = refreshSettings().compactTokens;
  if (row?.role === "orchestrator" || tokens <= 0) return {};
  return { [AUTO_COMPACT_ENV]: String(Math.max(AUTO_COMPACT_MIN, tokens)) };
}

const k = (tokens: number) => `${Math.round(tokens / 1000)}k`;

// What the agent reads ahead of its first message in the new conversation.
export function refreshedNote(role: "orchestrator" | "task", tokens: number) {
  return role === "orchestrator"
    ? `(AgentOS started you on a fresh conversation: the last one passed ${k(tokens)} tokens of context. Your brief and "Where things stand" are current; carry on from them.)`
    : `(AgentOS started you on a fresh conversation: the last one passed ${k(tokens)} tokens of context. Your brief is above; check git status, git log and your PR to see how far you got, then carry on.)`;
}
