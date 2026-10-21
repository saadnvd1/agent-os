import type { ChatItem } from "../chat/events";
import { lineDiff } from "../chat/diff";
import { toolLine } from "../bus/condense";
import { redact, untrusted } from "../orchestrator/untrusted";
import { commandOf, isCheckCommand, signalLine, turnSignals } from "./signals";
import type { DigestSignals } from "./types";

// About 4k tokens for the whole digest.
export const DIGEST_CAP = 16_000;
const PROMPT_CAP = 2_000;
const REPLY_CAP = 4_000;
const OUTPUT_LINES = 40;
const OUTPUT_CAP = 2_000;
const DIFFS_CAP = 6_000;
const DIFF_CONTEXT = 1;

type Tool = Extract<ChatItem, { kind: "tool" }>;

const clip = (text: string, cap: number) =>
  text.length > cap
    ? `${text.slice(0, cap)}\n[… ${text.length - cap} more chars]`
    : text;

const tail = (text: string) => {
  const lines = text.trimEnd().split("\n");
  const kept = lines.slice(-OUTPUT_LINES).join("\n");
  const cut = kept.length > OUTPUT_CAP ? kept.slice(-OUTPUT_CAP) : kept;
  return lines.length > OUTPUT_LINES || cut.length < kept.length
    ? `[… earlier output left out]\n${cut}`
    : cut;
};

// The changed lines and one line around each, as a unified diff body.
export function hunks(before: string, after: string): string {
  const lines = lineDiff(before, after);
  const keep = new Set<number>();
  lines.forEach((l, i) => {
    if (l.op === " ") return;
    for (let k = i - DIFF_CONTEXT; k <= i + DIFF_CONTEXT; k++) keep.add(k);
  });
  const out: string[] = [];
  let last = -2;
  lines.forEach((l, i) => {
    if (!keep.has(i)) return;
    if (i > last + 1 && out.length) out.push("…");
    out.push(`${l.op}${l.text}`);
    last = i;
  });
  return out.join("\n");
}

// Output worth the analyst's context: a check's, or a call that failed.
const showsOutput = (t: Tool) => {
  const command = commandOf(t);
  return (
    !!t.output &&
    (t.status === "error" || (command !== null && isCheckCommand(command)))
  );
};

interface Section {
  prompt: string;
  reply: string[];
  tools: string[];
  diffs: { path: string; body: string }[];
}

function sections(items: ChatItem[]): Section[] {
  const out: Section[] = [];
  let cur: Section | null = null;
  const start = (prompt: string) => {
    cur = { prompt, reply: [], tools: [], diffs: [] };
    out.push(cur);
  };
  for (const item of items) {
    if (item.kind === "user") {
      // A message sent mid-turn is read inside the turn already running.
      if (item.midTurn && cur) {
        (cur as Section).reply.push(`[message during the turn] ${item.text}`);
        continue;
      }
      start(item.text);
      continue;
    }
    if (!cur) start("(earlier prompt, not in this batch)");
    const c = cur as unknown as Section;
    if (item.kind === "assistant" && item.text.trim()) c.reply.push(item.text);
    else if (item.kind === "error") c.reply.push(`[error] ${item.message}`);
    else if (item.kind === "plan") c.reply.push(`[plan] ${item.plan}`);
    else if (item.kind === "approval") c.tools.push(toolLine(item));
    else if (item.kind === "tool") {
      c.tools.push(toolLine(item));
      if (showsOutput(item))
        c.tools.push(
          tail(item.output!)
            .split("\n")
            .map((l) => `    ${l}`)
            .join("\n")
        );
      if (item.diff && item.status !== "error")
        c.diffs.push({
          path: item.diff.path,
          body: hunks(item.diff.before, item.diff.after),
        });
    } else if (item.kind === "turn_end" && item.interrupted)
      c.reply.push("[turn stopped by the user]");
    else if (item.kind === "turn_end" && item.ended)
      c.reply.push(`[turn ended early: ${item.ended.notice}]`);
  }
  return out;
}

function renderDiffs(diffs: Section["diffs"]): string {
  const parts: string[] = [];
  let used = 0;
  const left: string[] = [];
  for (const d of diffs) {
    const block = `--- ${d.path}\n${d.body}`;
    if (used + block.length > DIFFS_CAP) {
      left.push(d.path);
      continue;
    }
    parts.push(block);
    used += block.length;
  }
  if (left.length)
    parts.push(`+${left.length} more files: ${[...new Set(left)].join(", ")}`);
  return parts.join("\n");
}

function renderSection(s: Section, n: number, of: number): string {
  const label = of > 1 ? `Turn ${n} of ${of}` : "Turn";
  return [
    `## ${label}: prompt`,
    clip(s.prompt, PROMPT_CAP),
    `## ${label}: reply`,
    clip(s.reply.join("\n\n") || "(no text)", REPLY_CAP),
    s.tools.length ? `## Tools\n${s.tools.join("\n")}` : "## Tools\n(none)",
    s.diffs.length ? `## Changes\n${renderDiffs(s.diffs)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export interface Digest {
  text: string;
  signals: DigestSignals;
  // What the chat shows in its place.
  label: string;
}

/**
 * The coding agent's turns as the analyst reads them: signals counted here
 * first, then each turn's prompt, reply, tools, failing or check output and
 * diffs, fenced as untrusted. Oldest turns are dropped first to fit the cap.
 */
export function buildDigest(
  items: ChatItem[],
  opts: { coderName: string; through: string; brief?: string }
): Digest {
  const signals = turnSignals(items);
  const all = sections(items);
  const head = [
    opts.brief ?? "",
    `The coding agent "${opts.coderName}" finished ${
      signals.turns === 1 ? "a turn" : `${signals.turns} turns`
    }. Review it and end with your agentos-review block.`,
    `Signals (counted by AgentOS): ${redact(signalLine(signals))}`,
  ]
    .filter(Boolean)
    .join("\n");
  let kept = all;
  let body = "";
  let dropped = 0;
  for (;;) {
    body = kept
      .map((s, i) => renderSection(s, i + 1, kept.length))
      .join("\n\n");
    if (dropped)
      body = `[${dropped} earlier turn(s) left out to fit]\n\n${body}`;
    const text = `${head}\n\n${untrusted(`coding agent ${opts.coderName}`, body)}`;
    if (text.length <= DIGEST_CAP || kept.length <= 1)
      return {
        text:
          text.length > DIGEST_CAP
            ? clipDigest(head, opts.coderName, body)
            : text,
        signals,
        label: `${opts.coderName} · ${
          signals.turns === 1 ? "1 turn" : `${signals.turns} turns`
        } to review`,
      };
    kept = kept.slice(1);
    dropped++;
  }
}

// A single turn still over the cap: its tail end is what matters most.
function clipDigest(head: string, coderName: string, body: string): string {
  const room = DIGEST_CAP - head.length - 200;
  const cut =
    body.length > room ? `[… cut to fit]\n${body.slice(-room)}` : body;
  return `${head}\n\n${untrusted(`coding agent ${coderName}`, cut)}`;
}
