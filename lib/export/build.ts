/**
 * The export model: a chat's items as turns of structured, already-redacted
 * items, each cut labelled where it happens. Pure; the renderers
 * (markdown, json, html) only print it.
 */

import type { ChatItem } from "../chat/events";
import { lineDiff } from "../chat/diff";
import { isSecretPath } from "../secret-paths";
import { HIDDEN_FILE, strings } from "../share/snapshot";
import { htmlToMarkdown } from "../share/markdown";
import {
  addHits,
  noHits,
  redactForShare,
  type ShareContext,
} from "../share/redact";
import { FULL, cutInput, cutOutput, cutText, type Trunc } from "./compact";
import { groupTurns } from "./turns";
import {
  formatBytes,
  type ExportMode,
  type ExportRedact,
  type Hits,
} from "./view";

export type Counts = Record<string, number>;

export interface ExportItem {
  kind:
    | "user"
    | "assistant"
    | "thinking"
    | "tool"
    | "command_output"
    | "todos"
    | "task"
    | "plan"
    | "error"
    | "compacted"
    | "artifact";
  at: string;
  text?: string;
  /** User: who sent it, when not typed here. */
  from?: string;
  name?: string;
  title?: string;
  status?: string;
  input?: string;
  output?: string;
  durationMs?: number;
  diff?: { path: string; added: number; removed: number; patch?: string };
  todos?: { text: string; status: string }[];
  /** A short remark: "sent while the agent was working", an image count. */
  note?: string;
  attachments?: string[];
  truncated?: Trunc[];
}

export interface ExportTurn {
  /** 0 is whatever came before the first message. */
  n: number;
  startedAt: string;
  endedAt: string;
  durationMs?: number;
  costUsd?: number;
  interrupted?: boolean;
  /** Why the turn stopped short, when it did. */
  ended?: string;
  excerpt: string;
  items: ExportItem[];
  hits: Hits;
  omitted: Counts;
  truncated: Counts;
}

export interface ExportMeta {
  title: string;
  agent: string;
  model?: string;
  project?: string;
  created: string;
  timezone: string;
}

export interface ExportDoc {
  meta: ExportMeta;
  turns: ExportTurn[];
  /** Redactions in the title and project name. */
  metaHits: Hits;
}

export interface BuildInput {
  items: ChatItem[];
  meta: {
    name: string;
    agent: string;
    model?: string;
    project?: string;
    createdAt: number;
  };
  mode: ExportMode;
  redact: ExportRedact;
  ctx: ShareContext;
  /** Artifact pages by id, read only for a full export. */
  artifacts?: Record<string, string>;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO 8601 in the machine's own time zone, with its offset. */
export function isoLocal(ms: number): string {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const a = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${off >= 0 ? "+" : "-"}${pad(Math.floor(a / 60))}:${pad(a % 60)}`
  );
}

const bump = (c: Counts, key: string, by = 1) => {
  c[key] = (c[key] ?? 0) + by;
};

const stringify = (v: unknown, pretty: boolean) => {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, pretty ? 2 : undefined) ?? "";
  } catch {
    return "";
  }
};

/** Changed lines with two of context, as a unified-style patch. */
function patchOf(before: string, after: string) {
  const ops = lineDiff(before, after);
  let added = 0;
  let removed = 0;
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((o, i) => {
    if (o.op === " ") return;
    if (o.op === "+") added++;
    else removed++;
    for (let k = Math.max(0, i - 2); k <= Math.min(ops.length - 1, i + 2); k++)
      keep[k] = true;
  });
  const lines: string[] = [];
  let gap = false;
  ops.forEach((o, i) => {
    if (!keep[i]) {
      gap = lines.length > 0;
      return;
    }
    if (gap) lines.push("@@");
    gap = false;
    lines.push(`${o.op}${o.text}`);
  });
  return { added, removed, lines };
}

export function buildDoc(inp: BuildInput): ExportDoc {
  const { mode, ctx } = inp;
  const only = inp.redact === "secrets" ? { only: ["secret" as const] } : {};
  let metaHits = noHits();

  const doc: ExportDoc = {
    meta: {
      title: "",
      agent: inp.meta.agent,
      model: inp.meta.model,
      project: undefined,
      created: isoLocal(inp.meta.createdAt),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    turns: [],
    metaHits,
  };
  const redactMeta = (s: string) => {
    const r = redactForShare(s, ctx, only);
    metaHits = addHits(metaHits, r.hits);
    return r.text;
  };
  doc.meta.title = redactMeta(inp.meta.name).slice(0, 120) || "Chat";
  if (inp.meta.project) doc.meta.project = redactMeta(inp.meta.project);

  for (const turn of groupTurns(inp.items)) {
    const hits = noHits();
    const omitted: Counts = {};
    const truncated: Counts = {};
    const take = (s: string) => {
      const r = redactForShare(s, ctx, only);
      Object.assign(hits, addHits(hits, r.hits));
      return r.text;
    };
    /** Redact, then cut: a secret cut in half would otherwise slip through. */
    const prose = (s: string, what: string, field?: string) => {
      const cut = cutText(take(s), mode, field);
      if (cut.truncated) bump(truncated, what);
      return cut;
    };

    const items: ExportItem[] = [];
    let lastTodos = -1;
    if (mode === "compact")
      turn.items.forEach((i, k) => {
        if (i.kind === "todos") lastTodos = k;
      });

    let durationMs: number | undefined;
    let costUsd: number | undefined;
    let interrupted: boolean | undefined;
    let ended: string | undefined;
    let excerpt = "Session start";

    turn.items.forEach((item, k) => {
      const at = isoLocal(item.createdAt);
      switch (item.kind) {
        case "user": {
          const cut = prose(item.text, "user message");
          const attachments = [
            ...(item.files ?? []).map(
              (f) => `${take(f.name)} · ${formatBytes(f.size)}`
            ),
            ...(item.images ?? []).map(() => "[image not exported]"),
          ];
          if (turn.n > 0 && !item.midTurn)
            excerpt = redactForShare(item.text, ctx, only)
              .text.replace(/\s+/g, " ")
              .trim()
              .slice(0, 80);
          const from = item.origin?.label ?? item.from;
          items.push({
            kind: "user",
            at,
            text: cut.text,
            from: from ? take(from) : undefined,
            note: item.midTurn ? "sent while the agent was working" : undefined,
            attachments: attachments.length ? attachments : undefined,
            truncated: cut.truncated && [cut.truncated],
          });
          return;
        }
        case "assistant": {
          if (!item.text.trim()) return;
          const cut = prose(item.text, "agent message");
          items.push({
            kind: "assistant",
            at,
            text: cut.text,
            truncated: cut.truncated && [cut.truncated],
          });
          return;
        }
        case "reasoning": {
          if (!item.text.trim()) return;
          if (mode === "compact") return void bump(omitted, "thinking block");
          const cut = prose(item.text, "thinking block");
          items.push({
            kind: "thinking",
            at,
            text: cut.text,
            truncated: cut.truncated && [cut.truncated],
          });
          return;
        }
        case "tool": {
          const secret = strings(item.input).some(isSecretPath);
          const command =
            item.name === "Bash" &&
            typeof (item.input as { command?: unknown } | null)?.command ===
              "string";
          const raw = command
            ? (item.input as { command: string }).command
            : stringify(item.input, mode === "full");
          const input = cutInput(take(raw), mode, command);
          const output = cutOutput(
            secret ? HIDDEN_FILE : take(item.output ?? ""),
            mode,
            item.status === "error"
          );
          const truncs: Trunc[] = [];
          if (input.truncated) {
            truncs.push(input.truncated);
            bump(truncated, "tool input");
          }
          if (output.truncated) {
            truncs.push(output.truncated);
            bump(truncated, "tool output");
          }
          let diff: ExportItem["diff"];
          if (item.diff) {
            const hidden = isSecretPath(item.diff.path);
            const p = patchOf(item.diff.before, item.diff.after);
            diff = {
              path: take(item.diff.path),
              added: p.added,
              removed: p.removed,
            };
            if (mode === "full") {
              const lines = hidden ? [HIDDEN_FILE] : p.lines;
              const over = lines.length > FULL.patchLines;
              const shown = over ? lines.slice(0, FULL.patchLines) : lines;
              let patch = take(shown.join("\n"));
              if (over) {
                patch += `\n[truncated: showing first ${FULL.patchLines} of ${lines.length} diff lines; ${lines.length - FULL.patchLines} lines omitted (Full export)]`;
                truncs.push({
                  field: "diff",
                  how: `head${FULL.patchLines}`,
                  totalLines: lines.length,
                  keptLines: FULL.patchLines,
                  totalChars: lines.join("\n").length,
                  keptChars: patch.length,
                });
                bump(truncated, "file change");
              }
              diff.patch = patch;
            }
          }
          items.push({
            kind: "tool",
            at,
            name: item.name,
            title: take(item.title || item.name),
            status: item.status,
            input: input.text,
            output: output.text || undefined,
            durationMs: item.endedAt
              ? item.endedAt - item.createdAt
              : undefined,
            diff,
            truncated: truncs.length ? truncs : undefined,
          });
          return;
        }
        case "command_output": {
          const cut = cutOutput(take(item.text), mode, false);
          if (cut.truncated) bump(truncated, "command output");
          items.push({
            kind: "command_output",
            at,
            text: cut.text,
            truncated: cut.truncated && [cut.truncated],
          });
          return;
        }
        case "todos":
          if (mode === "compact" && k !== lastTodos)
            return void bump(omitted, "to-do list");
          items.push({
            kind: "todos",
            at,
            todos: item.todos.map((t) => ({
              text: take(t.text),
              status: t.status,
            })),
          });
          return;
        case "task":
          items.push({
            kind: "task",
            at,
            text:
              mode === "compact"
                ? `${take(item.description)}: ${item.status}`
                : take(
                    `${item.description}: ${item.status}${item.summary ? `. ${item.summary}` : ""}`
                  ),
            status: item.status,
          });
          return;
        case "plan": {
          const cut = prose(item.plan, "plan");
          items.push({
            kind: "plan",
            at,
            text: cut.text,
            note: item.carried ? "carried out" : undefined,
            truncated: cut.truncated && [cut.truncated],
          });
          return;
        }
        case "error": {
          const cut = prose(item.message, "error");
          items.push({
            kind: "error",
            at,
            text: cut.text,
            truncated: cut.truncated && [cut.truncated],
          });
          return;
        }
        case "compacted": {
          const sizes =
            item.before && item.after
              ? `, ${item.before} → ${item.after} tokens`
              : "";
          items.push({
            kind: "compacted",
            at,
            text: `Conversation compacted${item.trigger ? ` (${item.trigger})` : ""}${sizes}`,
          });
          return;
        }
        case "artifact": {
          const html = inp.artifacts?.[item.artifactId];
          const ex: ExportItem = {
            kind: "artifact",
            at,
            title: take(item.title),
          };
          if (mode === "compact") bump(omitted, "artifact");
          else if (html !== undefined) {
            const cut = cutText(htmlToMarkdown(take(html), 2), mode, "page");
            ex.text = cut.text;
            if (cut.truncated) {
              ex.truncated = [cut.truncated];
              bump(truncated, "artifact");
            }
          }
          items.push(ex);
          return;
        }
        case "turn_end":
          if (item.durationMs !== undefined)
            durationMs = (durationMs ?? 0) + item.durationMs;
          if (item.costUsd !== undefined)
            costUsd = (costUsd ?? 0) + item.costUsd;
          if (item.interrupted) interrupted = true;
          if (item.ended?.notice) ended = take(item.ended.notice);
          return;
        case "approval":
          return void bump(omitted, "approval");
        case "note":
          return void bump(omitted, "orchestrator note");
        case "mcp":
          return void bump(omitted, "MCP listing");
        default:
          return;
      }
    });

    const first = turn.items[0];
    const last = turn.items[turn.items.length - 1];
    doc.turns.push({
      n: turn.n,
      startedAt: isoLocal(first.createdAt),
      endedAt: isoLocal(last.createdAt),
      durationMs,
      costUsd,
      interrupted,
      ended,
      excerpt,
      items,
      hits,
      omitted,
      truncated,
    });
  }
  doc.metaHits = metaHits;
  return doc;
}
