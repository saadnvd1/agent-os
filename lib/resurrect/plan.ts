/**
 * A plan-only task's plan file lives in its worktree and in git nowhere, so a
 * worktree that's gone takes it along. The conversation still has it: the
 * Write that made it and the Edits after. Replays them.
 */

import { PLAN_FILE } from "../models/plan-step";

interface ToolUse {
  name?: string;
  input?: {
    file_path?: unknown;
    content?: unknown;
    old_string?: unknown;
    new_string?: unknown;
    replace_all?: unknown;
  };
}

function* toolUses(jsonl: string): Generator<ToolUse> {
  for (const line of jsonl.split("\n")) {
    if (!line.includes("tool_use")) continue;
    let entry: { message?: { content?: unknown } };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content)
      if (part?.type === "tool_use") yield part as ToolUse;
  }
}

export function planFromTranscript(jsonl: string): string | null {
  let text: string | null = null;
  for (const use of toolUses(jsonl)) {
    const file = use.input?.file_path;
    if (typeof file !== "string" || !file.endsWith(PLAN_FILE)) continue;
    if (use.name === "Write" && typeof use.input?.content === "string") {
      text = use.input.content;
    } else if (
      use.name === "Edit" &&
      text !== null &&
      typeof use.input?.old_string === "string" &&
      typeof use.input.new_string === "string" &&
      text.includes(use.input.old_string)
    ) {
      const { old_string: from, new_string: to } = use.input as {
        old_string: string;
        new_string: string;
      };
      text =
        use.input.replace_all === true
          ? text.split(from).join(to)
          : text.replace(from, () => to);
    }
  }
  return text;
}
