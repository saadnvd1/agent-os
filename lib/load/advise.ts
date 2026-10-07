// The advisory side of heavy commands: register one, and say what else is
// already running. Called by `aos heavy` and by the Claude PreToolUse hook.
import { randomUUID } from "crypto";
import { db } from "../db";
import { heavyLabel, heavyNote } from "./heavy";
import { currentLevel, heavyRegistry } from "./monitor";

function sessionName(sessionId: string | null): string | null {
  if (!sessionId) return null;
  const row = db
    .prepare(`SELECT name FROM sessions WHERE id = ?`)
    .get(sessionId) as { name: string } | undefined;
  return row?.name ?? null;
}

export function adviseHeavy(run: {
  key: string;
  sessionId: string | null;
  label: string;
  pid: number | null;
}): string | null {
  const registry = heavyRegistry();
  const others = registry.active().filter((r) => r.key !== run.key);
  registry.add({ ...run, sessionName: sessionName(run.sessionId) });
  return heavyNote(others, currentLevel());
}

interface HookInput {
  tool_name?: string;
  tool_use_id?: string;
  tool_input?: { command?: unknown; run_in_background?: unknown };
}

// What the hook prints to Claude (its JSON output), or "" for nothing.
export function hookOutput(
  event: string,
  sessionId: string | null,
  input: HookInput
): string {
  if (input.tool_name !== "Bash") return "";
  const command = input.tool_input?.command;
  if (typeof command !== "string") return "";
  const key = `tool:${input.tool_use_id ?? randomUUID()}`;
  if (event === "PostToolUse") {
    // A background command is still running when its call returns; it
    // ages out instead.
    if (!input.tool_input?.run_in_background) heavyRegistry().finish(key);
    return "";
  }
  if (event !== "PreToolUse") return "";
  const label = heavyLabel(command);
  if (!label) return "";
  const note = adviseHeavy({ key, sessionId, label, pid: null });
  if (!note) return "";
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: note,
    },
  });
}
