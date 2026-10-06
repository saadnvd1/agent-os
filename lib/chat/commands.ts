import type { ChatCommand } from "./events";

// The command being typed, if the message is still just "/something".
// Agents only run a command that opens the message.
export function slashQuery(text: string): string | null {
  const m = /^\/(\S*)$/.exec(text);
  return m ? m[1].toLowerCase() : null;
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
