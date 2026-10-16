import {
  normalizeCommand,
  scrub,
  genericPath,
} from "@/lib/session-audit/normalize";
import { ENV_CLASSES, READERS, SHELL_TOOLS } from "./classes";
import type { EnvHit } from "./types";

export interface ToolResult {
  tool: string;
  input: unknown;
  output: string;
  status: string;
}

// How much of a long output is read: the error is at the end of a traceback.
export const TAIL = 32_000;

function commandOf(tool: string, input: unknown): string {
  const i = (input && typeof input === "object" ? input : {}) as Record<
    string,
    unknown
  >;
  const c = i.command ?? i.cmd;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.join(" ");
  const file = i.file_path ?? i.path;
  return typeof file === "string" ? `${tool} ${genericPath(file)}` : tool;
}

// True when every part of the command only reads (after `cd`).
function onlyReads(command: string): boolean {
  const parts = command
    .split(/\n|&&|\|\||;|\|/)
    .map((p) => p.trim())
    .filter((p) => p && !/^cd\s/.test(p));
  return parts.length > 0 && parts.every((p) => READERS.test(p));
}

export function classifyToolResult(r: ToolResult): EnvHit | null {
  if (!r.output) return null;
  const shell = SHELL_TOOLS.has(r.tool.toLowerCase());
  const command = commandOf(r.tool, r.input);
  const text = r.output.length > TAIL ? r.output.slice(-TAIL) : r.output;
  const lines = text.split("\n");
  const reads = shell && onlyReads(command);
  for (const c of ENV_CLASSES) {
    if (c.scope === "shell" ? !shell || reads : r.status !== "error") continue;
    const line = lines.find((l) => c.match.some((m) => m.test(l.trim())));
    if (line === undefined) continue;
    if (c.requires && !c.requires.test(text)) continue;
    if (c.except?.command?.test(command) || c.except?.output?.test(text))
      continue;
    // The command names the very text it found: a search, not a failure.
    if (shell && command.toLowerCase().includes(line.trim().toLowerCase()))
      continue;
    const hit = c.match.map((m) => m.exec(line.trim())?.[0]).find(Boolean);
    if (shell && hit && command.toLowerCase().includes(hit.toLowerCase()))
      continue;
    return {
      class: c.id,
      line: scrub(line.trim()).slice(0, 200),
      command: normalizeCommand(command),
    };
  }
  return null;
}
