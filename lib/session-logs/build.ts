/**
 * A merged task's log as markdown, from data gathered by gather.ts. A fixed
 * template and nothing else: no model is ever asked to write or summarise
 * it. Text that came from a task, CI, a reviewer or a person is untrusted:
 * long text goes in a fence it can't close, short text in a code span, so it
 * can't add headings, links or sections to the document.
 */

import { redact } from "../orchestrator/untrusted";

export interface LogEvent {
  // SQLite UTC time ("YYYY-MM-DD HH:MM:SS"), or null when none was recorded.
  at: string | null;
  // AgentOS's own words for what happened.
  text: string;
  sha?: string | null;
  // A short untrusted value that belongs in the sentence (a check's name).
  quote?: string | null;
  // Longer untrusted text (a verdict, an answer).
  detail?: string | null;
}

export interface LogUsageRow {
  role: string;
  model: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  // The price table doesn't list the model: the cost is a floor.
  unpriced: boolean;
}

export interface LogData {
  id: string;
  name: string;
  workspace: string | null;
  project: string | null;
  branch: string | null;
  prNumber: number | null;
  prUrl: string | null;
  mergeCommit: string | null;
  startedAt: string | null;
  mergedAt: string | null;
  prompt: string;
  scopeChanges: { at: string; text: string }[];
  // null: the task wrote no plan. planKept false: it may have, and the file
  // was gone before the log was written.
  plan: string | null;
  planKept: boolean;
  timeline: LogEvent[];
  usage: LogUsageRow[];
  outcome: string | null;
  // The session in the AgentOS UI, as a path.
  sessionPath: string;
  // Caps applied to long text, so a log stays readable.
  verdictChars?: number;
}

export const VERDICT_CHARS = 1500;

const fence = (text: string): string => {
  const runs = text.match(/`+/g) ?? [];
  const longest = runs.reduce((n, r) => Math.max(n, r.length), 0);
  const ticks = "`".repeat(Math.max(3, longest + 1));
  return `${ticks}text\n${text}\n${ticks}`;
};

const clean = (text: string) => redact(text.replace(/\r\n?/g, "\n")).trim();

export const trim = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max).trimEnd()}\n… (trimmed)` : text;

const oneLine = (text: string) => clean(text).replace(/\s+/g, " ");

// Inline untrusted text as a code span, whatever it contains.
export function codeSpan(text: string): string {
  const t = oneLine(text) || "(empty)";
  const runs = t.match(/`+/g) ?? [];
  const longest = runs.reduce((n, r) => Math.max(n, r.length), 0);
  const ticks = "`".repeat(longest + 1);
  const pad = t.startsWith("`") || t.endsWith("`") ? " " : "";
  return `${ticks}${pad}${t}${pad}${ticks}`;
}

// Untrusted text in a heading or a table cell: no markup survives.
const plain = (text: string) =>
  oneLine(text).replace(/[\\`*_{}[\]<>()#+!|~&]/g, (c) => `\\${c}`);

const indent = (block: string, by = 2) =>
  block
    .split("\n")
    .map((l) => (l ? " ".repeat(by) + l : l))
    .join("\n");

const when = (at: string | null) =>
  at ? `${at.slice(0, 16).replace("T", " ")} UTC` : "—";

export function formatDuration(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  return [d && `${d}d`, (d || h) && `${h}h`, `${m}m`].filter(Boolean).join(" ");
}

// SQLite's UTC "YYYY-MM-DD HH:MM:SS" to ms.
export const sqliteMs = (at: string | null | undefined): number | null => {
  if (!at) return null;
  const ms = Date.parse(
    `${at.replace(" ", "T")}${at.includes("Z") ? "" : "Z"}`
  );
  return Number.isNaN(ms) ? null : ms;
};

const n = (x: number) => x.toLocaleString("en-US");
const usd = (x: number, floor: boolean) =>
  `${floor ? "≥ " : ""}$${x.toFixed(x >= 1 ? 2 : 4)}`;

// A link only when it is a plain web address; anything else is shown as text.
const url = (u: string) =>
  /^https?:\/\/[^\s<>()[\]`]+$/.test(u) ? `<${u}>` : codeSpan(u);

function header(d: LogData): string {
  const start = sqliteMs(d.startedAt);
  const end = sqliteMs(d.mergedAt);
  const duration =
    start !== null && end !== null ? formatDuration(end - start) : "unknown";
  const rows: [string, string][] = [
    ["Task", `${codeSpan(d.name)} (${codeSpan(d.id)})`],
    ["Workspace", d.workspace ? codeSpan(d.workspace) : "none"],
    ["Project", d.project ? codeSpan(d.project) : "none"],
    ["Branch", d.branch ? codeSpan(d.branch) : "none"],
    [
      "Pull request",
      d.prNumber
        ? `#${d.prNumber}${d.prUrl ? ` ${url(d.prUrl)}` : ""}`
        : "none recorded",
    ],
    ["Merge commit", d.mergeCommit ? codeSpan(d.mergeCommit) : "not recorded"],
    ["Started", when(d.startedAt)],
    ["Merged", when(d.mergedAt)],
    ["Duration", duration],
  ];
  return rows.map(([k, v]) => `- **${k}:** ${v}`).join("\n");
}

function brief(d: LogData): string {
  const parts = [
    "## Brief",
    "",
    "### Original prompt",
    "",
    fence(clean(d.prompt)),
  ];
  if (d.scopeChanges.length) {
    parts.push("", "### Scope changes", "");
    d.scopeChanges.forEach((c, i) => {
      parts.push(
        `${i + 1}. ${when(c.at)}`,
        "",
        indent(fence(clean(c.text))),
        ""
      );
    });
    parts.pop();
  }
  return parts.join("\n");
}

function plan(d: LogData): string {
  const body =
    d.plan !== null
      ? fence(clean(d.plan))
      : d.planKept
        ? "This task wrote no plan."
        : "Plan not kept: this log was written after the task's worktree was removed.";
  return `## Plan\n\n${body}`;
}

function timeline(d: LogData): string {
  const cap = d.verdictChars ?? VERDICT_CHARS;
  if (!d.timeline.length) return "## Timeline\n\nNothing was recorded.";
  const lines = d.timeline.map((e) => {
    const sha = e.sha ? ` on ${codeSpan(e.sha.slice(0, 7))}` : "";
    const quote = e.quote ? `: ${codeSpan(trim(e.quote, 300))}` : "";
    const head = `- ${e.at ? `${when(e.at)} — ` : ""}${e.text}${sha}${quote}`;
    return e.detail
      ? `${head}\n\n${indent(fence(trim(clean(e.detail), cap)))}\n`
      : head;
  });
  return `## Timeline\n\n${lines.join("\n").replace(/\n+$/, "")}`;
}

function usage(d: LogData): string {
  if (!d.usage.length)
    return "## Usage\n\nNo model usage was recorded for this task.";
  const head = [
    "| Role | Model | Turns | Input | Output | Cache read | Cache write | Cost |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  const rows = d.usage.map(
    (u) =>
      `| ${plain(u.role)} | ${plain(u.model)} | ${n(u.turns)} | ${n(u.inputTokens)} | ${n(u.outputTokens)} | ${n(u.cacheReadTokens)} | ${n(u.cacheWriteTokens)} | ${usd(u.costUsd, u.unpriced)} |`
  );
  const sum = d.usage.reduce(
    (t, u) => ({
      turns: t.turns + u.turns,
      i: t.i + u.inputTokens,
      o: t.o + u.outputTokens,
      cr: t.cr + u.cacheReadTokens,
      cw: t.cw + u.cacheWriteTokens,
      c: t.c + u.costUsd,
      f: t.f || u.unpriced,
    }),
    { turns: 0, i: 0, o: 0, cr: 0, cw: 0, c: 0, f: false }
  );
  const total = `| **Total** | | ${n(sum.turns)} | ${n(sum.i)} | ${n(sum.o)} | ${n(sum.cr)} | ${n(sum.cw)} | ${usd(sum.c, sum.f)} |`;
  return `## Usage\n\n${[...head, ...rows, total].join("\n")}\n\nCosts are estimates at list prices.`;
}

function outcome(d: LogData): string {
  return `## Outcome\n\n${
    d.outcome
      ? fence(clean(d.outcome))
      : "The task agent left no final message (a terminal task keeps none)."
  }`;
}

function links(d: LogData): string {
  const items = [
    d.prUrl ? `- Pull request: ${url(d.prUrl)}` : null,
    `- Session in AgentOS: ${codeSpan(d.sessionPath)}`,
  ].filter(Boolean);
  return `## Links\n\n${items.join("\n")}`;
}

export function buildLogMarkdown(d: LogData): string {
  return (
    [
      `# Session log: ${plain(d.name)}`,
      header(d),
      brief(d),
      plan(d),
      timeline(d),
      usage(d),
      outcome(d),
      links(d),
    ].join("\n\n") + "\n"
  );
}
