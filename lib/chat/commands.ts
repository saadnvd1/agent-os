import type { ChatCommand, CommandSource } from "./events";

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

// The SDK ends a description with where the command comes from, "(user)",
// "(project)" or "(plugin-name)"; the menu's group header says that already.
export function stripSourceSuffix(description: string): string {
  return description.replace(
    /\s*\((?:user|project|builtin|plugin|[\w.-]+@[\w.-]+)\)\s*$/i,
    ""
  );
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
  const desc = c.description.toLowerCase();
  if (desc.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) return 12;
  if (desc.includes(q)) return 10;
  return 0;
}

// A match that only came from the description, not the name.
const DESCRIPTION_ONLY = 12;

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

// AgentOS's own command when forks are on: opens the fork sheet.
export const FORK_COMMAND: ChatCommand = {
  name: "fork",
  description: "Start background copies of this session",
};

export const isForkCommand = (text: string): boolean =>
  text.trim().toLowerCase() === "/fork";

export function withFork(commands: ChatCommand[]): ChatCommand[] {
  return commands.some((c) => c.name === "fork")
    ? commands
    : [FORK_COMMAND, ...commands];
}

export interface MenuGroup {
  label: string;
  commands: ChatCommand[];
}

const SOURCE_ORDER: CommandSource[] = [
  "project",
  "global",
  "plugin",
  "builtin",
];

export const SOURCE_LABEL: Record<CommandSource, string> = {
  project: "Project",
  global: "Global",
  plugin: "Plugin",
  builtin: "Built-in",
};

// "Global" / "Project" / "slack": the small label on a row.
export function sourceLabel(c: ChatCommand): string | null {
  if (!c.source) return null;
  return c.source === "plugin" && c.plugin ? c.plugin : SOURCE_LABEL[c.source];
}

// The ranked commands as the menu shows them: what was used last, then one
// section per source, then what only matched by description. A command with
// no known source (an agent that doesn't report one) stays in one flat list.
export function groupCommands(
  query: string,
  commands: ChatCommand[],
  recent: string[]
): MenuGroup[] {
  const ranked = rankCommands(query, commands);
  if (!commands.some((c) => c.source)) {
    return ranked.length ? [{ label: "", commands: ranked }] : [];
  }
  const groups: MenuGroup[] = [];
  const add = (label: string, list: ChatCommand[]) => {
    if (list.length) groups.push({ label, commands: list });
  };
  const rest = (c: ChatCommand) => !recent.includes(c.name);
  const used = recent
    .map((n) => ranked.find((c) => c.name === n))
    .filter((c): c is ChatCommand => !!c);
  add("Recent", used);
  const byName = (a: ChatCommand, b: ChatCommand) =>
    a.name.localeCompare(b.name);
  const named = ranked.filter(
    (c) => rest(c) && (!query || score(query, c) > DESCRIPTION_ONLY)
  );
  for (const src of SOURCE_ORDER) {
    const list = named.filter((c) => (c.source ?? "builtin") === src);
    // Alphabetical when nothing was typed; best match first otherwise.
    add(SOURCE_LABEL[src], query ? list : [...list].sort(byName));
  }
  add(
    "Matched in description",
    ranked.filter(
      (c) => rest(c) && query && score(query, c) <= DESCRIPTION_ONLY
    )
  );
  return groups;
}
