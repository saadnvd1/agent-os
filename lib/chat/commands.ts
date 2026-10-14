import type { ChatCommand } from "./events";

// The /command being typed: a "/" at the start of a line or after whitespace,
// then the partial name, right up to the caret. Not "a/b" or "http://x".
// `start` is where the "/" sits in the text before the caret.
export function slashQuery(
  beforeCaret: string
): { query: string; start: number } | null {
  const m = /(^|\s)\/([^\s/]*)$/.exec(beforeCaret);
  if (!m) return null;
  return { query: m[2].toLowerCase(), start: m.index + m[1].length };
}

function isSubsequence(q: string, s: string): boolean {
  let i = 0;
  for (const ch of s) if (ch === q[i]) i++;
  return i === q.length;
}

function score(q: string, c: ChatCommand): number {
  const name = c.name.toLowerCase();
  if (!q) return 1;
  if (name === q) return 100;
  if (name.startsWith(q)) return 80 - Math.min(name.length - q.length, 30);
  const parts = name.split(/[:\-_]/);
  if (parts.some((p) => p.startsWith(q))) return 60;
  if (name.includes(q)) return 50;
  if (isSubsequence(q, name)) return 20;
  if (c.description.toLowerCase().includes(q)) return 10;
  return 0;
}

// Best matches first; ties keep the agent's own order.
export function rankCommands(
  query: string,
  commands: ChatCommand[],
  limit = 50
): ChatCommand[] {
  return commands
    .map((c, i) => ({ c, i, s: score(query, c) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.c);
}

export function insertCommand(name: string): string {
  return `/${name} `;
}

// "/review the auth module" -> "/review"; plain prose and paths -> null.
export function leadingCommand(text: string): string | null {
  return text.match(/^\/[\w:.-]+(?=\s|$)/)?.[0] ?? null;
}

// AgentOS's own command for an orchestrator or task: starts the agent's
// conversation over, with today's brief and permissions.
export const FRESH_COMMAND: ChatCommand = {
  name: "fresh",
  description: "Start a fresh conversation with the current brief",
};

export const isFreshCommand = (text: string): boolean =>
  text.trim().toLowerCase() === "/fresh";

export function withFresh(commands: ChatCommand[]): ChatCommand[] {
  return commands.some((c) => c.name === "fresh")
    ? commands
    : [FRESH_COMMAND, ...commands];
}
