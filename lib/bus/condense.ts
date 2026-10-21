import type { ChatItem } from "../chat/events";
import { toolTitle } from "../chat/tools";

// A chat as an agent reads it cheaply: prompts and replies in full, a tool
// call as one line, tool results left out (an env dump or a tokenvault
// answer can sit in one).

export const READ_DEFAULT_TURNS = 4;
// About 3k tokens: what one read returns unless it is asked for everything.
export const READ_CAP = 12_000;
export const TERMINAL_LINES = 80;
export const TERMINAL_LINES_ALL = 400;

export interface Turn {
  // 1-based; 0 for what came before the first prompt.
  index: number;
  lines: string[];
}

type Input = Record<string, unknown>;

const oneLine = (s: unknown, max = 160) => {
  if (typeof s !== "string") return "";
  const line = s.trim().split("\n")[0];
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

// The argument that says what a call did: a path, a command, a query.
function keyArg(name: string, input: unknown): string {
  const i = (input && typeof input === "object" ? input : {}) as Input;
  const s = (k: string) => oneLine(i[k]);
  switch (name) {
    case "Bash":
      return s("command");
    case "Read":
    case "Edit":
    case "Write":
    case "MultiEdit":
      return s("file_path");
    case "NotebookEdit":
      return s("notebook_path");
    case "Grep":
      return [s("pattern"), s("path")].filter(Boolean).join(" in ");
    case "Glob":
      return s("pattern");
    case "WebFetch":
      return s("url");
    case "WebSearch":
      return s("query");
    case "Task":
    case "Agent":
      return s("description");
    case "Skill":
      return s("skill");
    default:
      return "";
  }
}

export function toolLine(
  item: Extract<ChatItem, { kind: "tool" | "approval" }>
): string {
  const name = item.kind === "tool" ? item.name : item.toolName;
  const arg = keyArg(name, item.input);
  const mcp = name.match(/^mcp__(.+?)__(.+)$/);
  const text = arg
    ? `${name} ${arg}`
    : mcp
      ? toolTitle(name, item.input)
      : `${name} ${oneLine(item.title)}`.trim();
  if (item.kind === "approval") return `· ${text} (approval ${item.status})`;
  const suffix =
    item.status === "error"
      ? " (failed)"
      : item.status === "stopped"
        ? " (stopped)"
        : item.status === "running"
          ? " (running)"
          : "";
  return `· ${text}${suffix}`;
}

function lineOf(i: ChatItem): string | null {
  switch (i.kind) {
    case "user":
      return `[${i.from ? `from ${i.from}` : "user"}] ${i.text}`;
    case "assistant":
      return `[assistant] ${i.text}`;
    case "tool":
    case "approval":
      return toolLine(i);
    case "plan":
      return `[plan] ${i.plan}`;
    case "error":
      return `[error] ${i.message}`;
    case "note":
      return `[${i.tone}] ${i.text}`;
    case "command_output": {
      const n = i.text.split("\n").length;
      return `[command output: ${n} line${n === 1 ? "" : "s"} left out]`;
    }
    case "compacted":
      return "[conversation compacted]";
    case "turn_end":
      return i.interrupted
        ? "[turn stopped]"
        : i.ended
          ? `[turn ended early: ${i.ended.reason}]`
          : null;
    default:
      return null;
  }
}

// Items oldest first, grouped by prompt. `before` is how many prompts came
// ahead of the first item given, when it is only the end of the chat.
export function condenseItems(items: ChatItem[], before = 0): Turn[] {
  const turns: Turn[] = [];
  let cur: Turn = { index: before, lines: [] };
  for (const item of items) {
    if (item.kind === "user") {
      turns.push(cur);
      cur = { index: cur.index + 1, lines: [] };
    }
    const line = lineOf(item);
    if (line) cur.lines.push(line);
  }
  turns.push(cur);
  return turns.filter((t) => t.lines.length);
}

export interface Rendered {
  text: string;
  from: number;
  to: number;
  truncated: boolean;
}

const block = (t: Turn) =>
  `${t.index > 0 ? `── turn ${t.index} ──\n` : ""}${t.lines.join("\n")}`;

// The end of a text within the cap, from a line boundary.
function clip(text: string, cap: number): string {
  if (text.length <= cap) return text;
  const cut = text.slice(text.length - cap + 1);
  const nl = cut.indexOf("\n");
  return `…${nl >= 0 && nl < cut.length / 2 ? cut.slice(nl) : cut}`;
}

// The last `turns` turns, or the last `lines` lines, within the cap
// unless `all`.
export function renderTurns(
  turns: Turn[],
  o: { turns?: number; lines?: number; all?: boolean; cap?: number }
): Rendered {
  const cap = o.cap ?? READ_CAP;
  if (!turns.length) return { text: "", from: 0, to: 0, truncated: false };
  let picked = turns;
  if (!o.all) {
    if (o.lines) {
      let n = 0;
      let start = turns.length;
      while (start > 0 && n < o.lines) n += turns[--start].lines.length;
      picked = turns.slice(start);
    } else picked = turns.slice(-(o.turns ?? READ_DEFAULT_TURNS));
  }
  let truncated = picked.length < turns.length;
  let text: string;
  if (o.lines && !o.all) {
    const all = picked.flatMap((t) => t.lines);
    text = all.slice(-o.lines).join("\n");
    truncated ||= all.length > o.lines;
  } else text = picked.map(block).join("\n");
  if (!o.all) {
    while (picked.length > 1 && text.length > cap) {
      picked = picked.slice(1);
      text = picked.map(block).join("\n");
      truncated = true;
    }
    if (text.length > cap) {
      text = clip(text, cap);
      truncated = true;
    }
  }
  const first = picked[0].index;
  return { text, from: first, to: picked[picked.length - 1].index, truncated };
}

// Only the lines that match, two either side, under their turn.
export function grepTurns(
  turns: Turn[],
  needle: string,
  o: { all?: boolean; cap?: number } = {}
): Rendered {
  const n = needle.toLowerCase();
  const parts: { index: number; text: string }[] = [];
  for (const t of turns) {
    const hit = t.lines.flatMap((l, i) =>
      l.toLowerCase().includes(n) ? [i] : []
    );
    if (!hit.length) continue;
    const keep = new Set<number>();
    for (const i of hit)
      for (let k = i - 2; k <= i + 2; k++)
        if (k >= 0 && k < t.lines.length) keep.add(k);
    const out: string[] = [];
    let prev = -2;
    for (const k of [...keep].sort((a, b) => a - b)) {
      if (k > prev + 1 && out.length) out.push("--");
      out.push(t.lines[k]);
      prev = k;
    }
    parts.push({
      index: t.index,
      text: `${t.index > 0 ? `── turn ${t.index} ──\n` : ""}${out.join("\n")}`,
    });
  }
  if (!parts.length) return { text: "", from: 0, to: 0, truncated: false };
  const cap = o.cap ?? READ_CAP;
  let kept = parts;
  let text = kept.map((p) => p.text).join("\n");
  let truncated = false;
  if (!o.all) {
    while (kept.length > 1 && text.length > cap) {
      kept = kept.slice(1);
      text = kept.map((p) => p.text).join("\n");
      truncated = true;
    }
    if (text.length > cap) {
      text = clip(text, cap);
      truncated = true;
    }
  }
  return {
    text,
    from: kept[0].index,
    to: kept[kept.length - 1].index,
    truncated,
  };
}

// Screen text, only the lines that match with two either side.
export function grepText(text: string, needle: string): string {
  const r = grepTurns([{ index: 0, lines: text.split("\n") }], needle);
  return r.text || `no lines match "${needle}"`;
}
