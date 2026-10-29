/**
 * The command palette's actions. Features add theirs under a source name and
 * take them back the same way, so the palette itself knows no feature.
 */

export type PaletteTab =
  "all" | "sessions" | "commands" | "settings" | "conversations";

export const PALETTE_TABS: { id: PaletteTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "sessions", label: "Sessions" },
  { id: "commands", label: "Commands" },
  { id: "settings", label: "Settings" },
  { id: "conversations", label: "Conversations" },
];

// Which tab each heading's commands are found under; a heading not listed is
// a command. A command can name its own tab instead.
const GROUP_TAB: Record<string, PaletteTab> = {
  Sessions: "sessions",
  Settings: "settings",
  Conversations: "conversations",
};

// Headings whose commands act on the focused session.
const SESSION_GROUPS = new Set(["Chat", "Task"]);

export function tabOf(c: PaletteCommand): PaletteTab {
  return c.tab ?? GROUP_TAB[c.group] ?? "commands";
}

export function actsOnFocusedSession(c: PaletteCommand): boolean {
  return SESSION_GROUPS.has(c.group);
}

export interface PaletteCommand {
  id: string;
  title: string;
  // The heading it's listed under.
  group: string;
  // Other words it should be found by.
  keywords?: string[];
  // Shown beside it, e.g. ⌘K.
  hint?: string;
  // A line under the title (what a conversation hit said).
  detail?: string;
  // Overrides the tab its group maps to.
  tab?: PaletteTab;
  // A session that is working or waiting on the user.
  status?: "running" | "waiting";
  // Running it leaves the palette open (it changes the palette itself).
  keepOpen?: boolean;
  icon?: unknown;
  run: () => void;
}

export class PaletteRegistry {
  private sources = new Map<string, PaletteCommand[]>();
  private listeners = new Set<() => void>();
  private snapshot: PaletteCommand[] = [];

  // Replaces what a source offers; returns how to take it back.
  register(source: string, commands: PaletteCommand[]): () => void {
    this.sources.set(source, commands);
    this.changed();
    return () => {
      if (this.sources.get(source) !== commands) return;
      this.sources.delete(source);
      this.changed();
    };
  }

  // Every command, the first registered source's first; an id offered twice
  // keeps its latest.
  list(): PaletteCommand[] {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    const byId = new Map<string, PaletteCommand>();
    for (const commands of this.sources.values())
      for (const c of commands) {
        byId.delete(c.id);
        byId.set(c.id, c);
      }
    this.snapshot = [...byId.values()];
    for (const l of this.listeners) l();
  }
}

// How well a query matches some text: every query character in order, with
// credit for runs and word starts. Null when it doesn't match at all.
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return 0;
  const t = text.toLowerCase();
  const exact = t.indexOf(query.trim().toLowerCase());
  if (exact !== -1) {
    const atWord = exact === 0 || /[\s\-_/.:]/.test(t[exact - 1]);
    return 1000 - exact + (atWord ? 200 : 0);
  }
  let score = 0;
  let ti = 0;
  let run = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    run = found === ti ? run + 1 : 0;
    const atWord = found === 0 || /[\s\-_/.:]/.test(t[found - 1]);
    score += 1 + run * 3 + (atWord ? 8 : 0) - Math.min(found - ti, 10) * 0.5;
    ti = found + 1;
  }
  return score;
}

export interface Scored {
  c: PaletteCommand;
  score: number;
}

// The commands a query finds, best first, with their scores. `boost` (0 to 1,
// e.g. how much it's used) scales a match up by at most half: it can break a
// close call, never rescue a non-match or outrank a far better match. With no
// query the boost alone orders them, registry order breaking ties.
export function scoreCommands(
  commands: PaletteCommand[],
  query: string,
  boost: (c: PaletteCommand) => number = () => 0
): Scored[] {
  const empty = !query.trim();
  return commands
    .map((c, i) => {
      let base = 0;
      if (!empty) {
        const scores = [c.title, ...(c.keywords ?? []), c.group].map(
          (text, j) => {
            const s = fuzzyScore(query, text);
            // A title match counts most.
            return s === null ? null : j === 0 ? s * 1.5 : s;
          }
        );
        base = Math.max(...scores.map((s) => s ?? -Infinity));
      }
      const b = boost(c);
      return { c, i, base, score: empty ? b : base + Math.abs(base) * 0.5 * b };
    })
    .filter((m) => m.base > -Infinity)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ c, score }) => ({ c, score }));
}

export function matchCommands(
  commands: PaletteCommand[],
  query: string
): PaletteCommand[] {
  return scoreCommands(commands, query).map((m) => m.c);
}
