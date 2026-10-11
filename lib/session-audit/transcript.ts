/**
 * One Claude Code transcript (a JSONL file) read a line at a time into what
 * the audit needs: the context each turn read, every tool call with the size
 * of what it returned, and the messages AgentOS typed into the session. The
 * file is streamed, never loaded whole; a long session is tens of megabytes.
 */

import fs from "fs";
import readline from "readline";
import { createHash } from "crypto";
import { UNTRUSTED_RULE, untrusted } from "../orchestrator/untrusted";
import {
  estTokens,
  manualClasses,
  normalizeCommand,
  normalizeError,
  repoPath,
  shellReadTarget,
  wasteClasses,
  scrub,
  type ManualClass,
  type WasteClass,
} from "./normalize";

export interface Range {
  since: number;
  until: number;
}

export interface ToolCall {
  tool: string;
  /** The same call in any session: a normalised command, a repo path. */
  key: string;
  /** A hash of this exact call, for spotting one session repeating itself. */
  exact: string;
  /** A short excerpt of the input, for the local report only. */
  excerpt: string;
  at: string;
  /** Main-chain turns before this call, for how long its output stayed in context. */
  turn: number;
  tokens: number;
  /** Its output's tokens times the turns that re-read it before a compaction. An estimate. */
  carried: number;
  isError: boolean;
  error: string | null;
  readPath: string | null;
  waste: WasteClass[];
  manual: ManualClass[];
  agentType: string | null;
}

export type InjectedKind =
  | "nudge"
  | "restart-mid-turn"
  | "restart-between-turns";

export interface Injected {
  kind: InjectedKind;
  from: string | null;
  text: string;
  at: string;
}

export interface TranscriptStats {
  file: string;
  turns: number;
  tokensRead: number;
  tokensWritten: number;
  cacheWrite: number;
  peakContext: number;
  /** Context read on turns that were already past 300k. */
  readPast300k: number;
  /** What the same turns would have read with context held to 150k. */
  ceiling150k: number;
  /** The first turn's context: system prompt, tools, brief. */
  baselineContext: number | null;
  compactions: number;
  firstAt: string | null;
  lastAt: string | null;
  calls: ToolCall[];
  injected: Injected[];
  /** Big user prompts sent more than once, by hash. */
  resent: { hash: string; chars: number; count: number }[];
}

const NUDGE =
  /^\[AgentOS message from (?:"([^"]+)"|([^\]]+?)) ?(?:\([0-9a-f]{8}\))?\]/;
const RESTART_MID = "AgentOS restarted while you were working";
const RESTART_BETWEEN = "(AgentOS was updated and restarted you between turns";
const RESENT_MIN_CHARS = 1500;

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null;

function contentText(content: unknown): { text: string; chars: number } {
  if (typeof content === "string")
    return { text: content, chars: content.length };
  if (!Array.isArray(content)) return { text: "", chars: 0 };
  let text = "";
  let chars = 0;
  for (const block of content) {
    if (!isObj(block)) continue;
    if (block.type === "text" && typeof block.text === "string") {
      text += block.text;
      chars += block.text.length;
    } else if (block.type === "image") {
      // Images are billed by size, roughly this much for a screenshot.
      chars += 6000;
    } else if (block.type === "tool_reference" || block.type === "document") {
      chars += JSON.stringify(block).length;
    }
  }
  return { text, chars };
}

function describeCall(
  name: string,
  input: Json,
  cwd: string | null
): Omit<ToolCall, "at" | "turn" | "tokens" | "carried" | "isError" | "error"> {
  const str = (k: string) =>
    typeof input[k] === "string" ? (input[k] as string) : "";
  const base = {
    tool: name,
    readPath: null as string | null,
    waste: [] as WasteClass[],
    manual: [] as ManualClass[],
    agentType: null as string | null,
  };
  if (name === "Bash") {
    const command = str("command");
    const target = shellReadTarget(command);
    return {
      ...base,
      key: normalizeCommand(command),
      exact: command.slice(0, 400),
      excerpt: scrub(command.replace(/\s*\n\s*/g, " ⏎ ")).slice(0, 240),
      readPath: target ? repoPath(absolute(target, cwd)) : null,
      waste: wasteClasses(command),
      manual: manualClasses(command),
    };
  }
  if (name === "Read") {
    const p = repoPath(str("file_path"));
    const window =
      input.offset || input.limit
        ? ` [${input.offset ?? 0}+${input.limit ?? "…"}]`
        : "";
    return {
      ...base,
      key: p,
      exact: `${str("file_path")}${window}`,
      excerpt: `${p}${window}`,
      readPath: p,
    };
  }
  if (name === "Grep" || name === "Glob") {
    const key = scrub(
      `${str("pattern").slice(0, 60)} in ${repoPath(str("path")) || "."}`
    );
    return {
      ...base,
      key,
      exact: JSON.stringify(input).slice(0, 400),
      excerpt: key,
    };
  }
  if (name === "Agent" || name === "Task") {
    const type = str("subagent_type") || "general-purpose";
    const key = `${type}: ${normalizeCommand(str("description"))}`;
    const prompt = str("prompt");
    return {
      ...base,
      key,
      exact: `${type}:${createHash("sha1").update(prompt).digest("hex").slice(0, 12)}`,
      excerpt: key,
      agentType: type,
    };
  }
  const json = JSON.stringify(input) ?? "";
  return {
    ...base,
    key: `${name} ${normalizeCommand(json).slice(0, 80)}`,
    exact: `${name} ${json.slice(0, 400)}`,
    excerpt: scrub(json).slice(0, 200),
  };
}

function absolute(p: string, cwd: string | null): string {
  if (p.startsWith("/") || p.startsWith("~") || !cwd) return p;
  return `${cwd.replace(/\/$/, "")}/${p}`;
}

/** Read one transcript, counting only what happened inside the range. */
export async function scanTranscript(
  file: string,
  range: Range,
  opts: { subagent?: boolean } = {}
): Promise<TranscriptStats> {
  const stats: TranscriptStats = {
    file,
    turns: 0,
    tokensRead: 0,
    tokensWritten: 0,
    cacheWrite: 0,
    peakContext: 0,
    readPast300k: 0,
    ceiling150k: 0,
    baselineContext: null,
    compactions: 0,
    firstAt: null,
    lastAt: null,
    calls: [],
    injected: [],
    resent: [],
  };
  const seenMessages = new Set<string>();
  const pending = new Map<string, ToolCall>();
  const resent = new Map<string, { chars: number; count: number }>();
  // Calls whose output is still in context: it leaves at a compaction.
  let open: ToolCall[] = [];
  let allTurns = 0;
  let cwd: string | null = null;

  const settle = () => {
    for (const call of open)
      call.carried = call.tokens * Math.max(0, allTurns - call.turn);
    open = [];
  };
  const inRange = (at: unknown): at is string => {
    if (typeof at !== "string") return false;
    const ms = Date.parse(at);
    return ms >= range.since && ms < range.until;
  };

  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line) continue;
    let e: Json;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof e.cwd === "string") cwd = e.cwd;
    const at = e.timestamp;
    // A subagent's own file is all sidechain; in it, that is the main line.
    const side = !opts.subagent && e.isSidechain === true;

    if (e.type === "system" && e.subtype === "compact_boundary") {
      settle();
      if (inRange(at)) stats.compactions++;
      continue;
    }

    const message = e.message;
    if (!isObj(message)) continue;

    if (e.type === "assistant") {
      const id = typeof message.id === "string" ? message.id : `${e.uuid}`;
      // Claude Code writes one line per content block, each repeating the
      // turn's usage: a turn is a message id, counted once.
      if (!seenMessages.has(id)) {
        seenMessages.add(id);
        if (!side) allTurns++;
        const usage = isObj(message.usage) ? message.usage : {};
        const n = (k: string) =>
          typeof usage[k] === "number" ? (usage[k] as number) : 0;
        const ctx =
          n("input_tokens") +
          n("cache_read_input_tokens") +
          n("cache_creation_input_tokens");
        if (inRange(at) && !side && ctx > 0) {
          stats.turns++;
          stats.tokensRead += ctx;
          stats.tokensWritten += n("output_tokens");
          stats.cacheWrite += n("cache_creation_input_tokens");
          stats.peakContext = Math.max(stats.peakContext, ctx);
          if (ctx > 300_000) stats.readPast300k += ctx;
          stats.ceiling150k += Math.min(ctx, 150_000);
          if (stats.baselineContext === null && allTurns === 1)
            stats.baselineContext = ctx;
          stats.firstAt ??= at;
          stats.lastAt = at;
        }
      }
      if (!inRange(at) || !Array.isArray(message.content)) continue;
      for (const block of message.content) {
        if (
          !isObj(block) ||
          block.type !== "tool_use" ||
          typeof block.id !== "string"
        )
          continue;
        const described = describeCall(
          String(block.name),
          isObj(block.input) ? block.input : {},
          cwd
        );
        const call: ToolCall = {
          ...described,
          // Only ever compared, so kept as a hash: no raw input stays.
          exact: createHash("sha1").update(described.exact).digest("hex"),
          at,
          turn: allTurns,
          tokens: 0,
          carried: 0,
          isError: false,
          error: null,
        };
        pending.set(block.id, call);
        stats.calls.push(call);
      }
      continue;
    }

    if (e.type !== "user" || !inRange(at)) continue;
    const content = message.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!isObj(block) || block.type !== "tool_result") continue;
        const call = pending.get(String(block.tool_use_id));
        if (!call) continue;
        pending.delete(String(block.tool_use_id));
        const { text, chars } = contentText(block.content);
        call.tokens = estTokens(chars);
        call.isError = block.is_error === true;
        if (call.isError) call.error = normalizeError(text);
        if (!side) open.push(call);
      }
    }
    const { text } = contentText(content);
    if (!text || side) continue;
    noteInjected(stats, text, at);
    if (
      text.length >= RESENT_MIN_CHARS &&
      !text.startsWith("<task-notification>")
    ) {
      const hash = createHash("sha1").update(text).digest("hex").slice(0, 12);
      const seen = resent.get(hash) ?? { chars: text.length, count: 0 };
      seen.count++;
      resent.set(hash, seen);
    }
  }
  settle();
  stats.resent = [...resent]
    .filter(([, v]) => v.count > 1)
    .map(([hash, v]) => ({ hash, ...v }));
  return stats;
}

function noteInjected(stats: TranscriptStats, text: string, at: string) {
  const trimmed = text.trimStart();
  const nudge = trimmed.match(NUDGE);
  if (nudge) {
    const body = trimmed
      .slice(nudge[0].length)
      .replace(/^:\s*/, "")
      .replace(/\s*Reply with: aos send .*$/, "");
    stats.injected.push({
      kind: "nudge",
      from: (nudge[1] ?? nudge[2] ?? "").trim() || null,
      text: normalizeError(body),
      at,
    });
  } else if (trimmed.includes(RESTART_MID)) {
    stats.injected.push({
      kind: "restart-mid-turn",
      from: null,
      text: RESTART_MID,
      at,
    });
  } else if (trimmed.includes(RESTART_BETWEEN)) {
    stats.injected.push({
      kind: "restart-between-turns",
      from: null,
      text: RESTART_BETWEEN,
      at,
    });
  }
}

export interface Excerpt {
  at: string;
  tool: string;
  input: string;
  output: string;
  isError: boolean;
}

/**
 * The few tool calls in a transcript whose input matches, each cut short:
 * what the skill reads when a number needs a concrete example, so it never
 * opens the transcript itself.
 */
export async function findExcerpts(
  file: string,
  range: Range,
  match: RegExp,
  limit: number
): Promise<Excerpt[]> {
  const out: Excerpt[] = [];
  const pending = new Map<string, Excerpt>();
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (out.length >= limit && pending.size === 0) break;
    let e: Json;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const at = e.timestamp;
    if (
      typeof at !== "string" ||
      Date.parse(at) < range.since ||
      Date.parse(at) >= range.until
    )
      continue;
    const message = e.message;
    if (!isObj(message) || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (!isObj(block)) continue;
      if (
        e.type === "assistant" &&
        block.type === "tool_use" &&
        out.length < limit
      ) {
        const input = scrub(JSON.stringify(block.input ?? {}));
        if (!match.test(input) && !match.test(String(block.name))) continue;
        const x: Excerpt = {
          at,
          tool: String(block.name),
          input: input.slice(0, 300),
          output: "",
          isError: false,
        };
        out.push(x);
        pending.set(String(block.id), x);
      } else if (e.type === "user" && block.type === "tool_result") {
        const x = pending.get(String(block.tool_use_id));
        if (!x) continue;
        pending.delete(String(block.tool_use_id));
        x.output = scrub(contentText(block.content).text).slice(0, 400);
        x.isError = block.is_error === true;
      }
    }
  }
  rl.close();
  return out;
}

/**
 * Excerpts as the auditing model reads them: each one fenced as untrusted
 * (session, terminal and CI text is data, never instructions), under the
 * rule that says so.
 */
export function formatExcerpts(excerpts: Excerpt[], sessionId: string): string {
  if (!excerpts.length) return "No matching calls.";
  const fenced = excerpts.map((x) =>
    untrusted(
      `transcript ${sessionId.slice(0, 8)} ${x.at}`,
      `${x.tool}${x.isError ? " (error)" : ""}\n  in:  ${x.input}\n  out: ${x.output.replace(/\n/g, "⏎ ")}`
    )
  );
  return [UNTRUSTED_RULE, ...fenced].join("\n");
}
