/**
 * Fresh starts: a chat whose context passes a threshold ends its agent's
 * conversation at the next turn boundary, and the next worker starts a new
 * one with the brief (lib/chat/worker/host). An orchestrator is fed events
 * nonstop, never idles and can't compact itself, so it's on for it by
 * default: its state is in the database and its brief carries it
 * (lib/orchestrator/digest). A task keeps its progress only in its
 * conversation and its branch, so for tasks it's off unless switched on.
 * App-wide, in Settings → Workspaces.
 */

import { db } from "../db";
import { MAX_REFRESH_TOKENS, MIN_REFRESH_TOKENS } from "./refresh-limits";

export const ORCHESTRATOR_KEY = "orchestrator.refresh_tokens";
export const TASK_KEY = "chat.task_refresh_tokens";
export const DEFAULT_ORCHESTRATOR_TOKENS = 200_000;
export { MIN_REFRESH_TOKENS, MAX_REFRESH_TOKENS } from "./refresh-limits";

export interface RefreshSettings {
  // Context tokens at which a conversation starts over; 0 is off.
  orchestratorTokens: number;
  taskTokens: number;
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
      `A fresh-start threshold is off or between ${MIN_REFRESH_TOKENS / 1000}k and ${MAX_REFRESH_TOKENS / 1000}k tokens`
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
  db.transaction(() => {
    for (const [key, n] of checked) put.run(key, String(n));
  })();
}

const k = (tokens: number) => `${Math.round(tokens / 1000)}k`;

// What the agent reads ahead of its first message in the new conversation.
export function refreshedNote(role: "orchestrator" | "task", tokens: number) {
  return role === "orchestrator"
    ? `(AgentOS started you on a fresh conversation: the last one passed ${k(tokens)} tokens of context. Your brief and "Where things stand" are current; carry on from them.)`
    : `(AgentOS started you on a fresh conversation: the last one passed ${k(tokens)} tokens of context. Your brief is above; check git status, git log and your PR to see how far you got, then carry on.)`;
}
