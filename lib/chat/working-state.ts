/**
 * What an agent needs to keep its place across a compaction. Claude Code's
 * summary decides for itself what mattered, and a long job's task, its scope
 * changes and the files it was editing are exactly what it dropped: the
 * agent re-read them and then rewrote whole files to be sure. So the summary
 * is told what to keep (COMPACT_INSTRUCTIONS), and right after it AgentOS
 * hands back a note built from its own records (workingStateNote), which
 * doesn't depend on what the summary kept.
 *
 * Pure, so the rules are tested without a database (lib/chat/compact-context
 * gathers the inputs).
 */

import type { ChatItem } from "./events";

export const COMPACT_INSTRUCTIONS = [
  "Keep, verbatim where short: the task or request you are working on and any changes to its scope.",
  "List every file you created or edited, by absolute path, and what you changed in each.",
  "State what is done, what is in progress, and the exact next step.",
  "Keep the decisions made and why, and any commands or checks still to run.",
  "After the summary, do not re-read whole files you were editing: search for the spot and edit it in place, and never rewrite a whole large file to change a part of it.",
].join(" ");

// In the system prompt, which the summary request reuses and a summary
// can't drop.
export const COMPACT_BRIEF = `If your context is compacted, the summary must: ${COMPACT_INSTRUCTIONS}`;

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const MAX_FILES = 20;
const MAX_PROMPT = 8_000;
const MAX_REQUEST = 1_500;
const MAX_NOTE = 12_000;

type Todo = Extract<ChatItem, { kind: "todos" }>["todos"][number];

export interface WorkingState {
  // The task's own prompt, when it is one, and its scope changes (oldest
  // first).
  taskPrompt?: string | null;
  amendments?: string[];
  // Tool calls and the latest todos and user messages, oldest first.
  tools?: Extract<ChatItem, { kind: "tool" }>[];
  todos?: Todo[];
  requests?: string[];
  // `git status --short`, when the directory is a repository.
  gitStatus?: string;
}

const cut = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}\n… (cut)` : text;

// The path a file-changing tool call is about, newest first, each once.
export function editedFiles(
  tools: Extract<ChatItem, { kind: "tool" }>[]
): string[] {
  const seen = new Set<string>();
  for (const t of [...tools].reverse()) {
    if (!EDIT_TOOLS.has(t.name) || t.status === "error") continue;
    const input = (t.input ?? {}) as Record<string, unknown>;
    const path = input.file_path ?? input.notebook_path ?? t.diff?.path;
    if (typeof path === "string" && path) seen.add(path);
    if (seen.size >= MAX_FILES) break;
  }
  return [...seen];
}

const MARK: Record<Todo["status"], string> = {
  completed: "done",
  in_progress: "in progress",
  pending: "next",
};

export function workingStateNote(s: WorkingState): string {
  const parts: string[] = [];
  const prompt = s.taskPrompt?.trim();
  if (prompt) parts.push(`## Your task\n${cut(prompt, MAX_PROMPT)}`);
  const amendments = (s.amendments ?? []).filter((a) => a.trim());
  if (amendments.length)
    parts.push(
      `## Scope changes since it started (oldest first; they change the task above)\n${amendments
        .map((a, i) => `${i + 1}. ${cut(a.trim(), MAX_REQUEST)}`)
        .join("\n")}`
    );
  const files = editedFiles(s.tools ?? []);
  if (files.length)
    parts.push(
      `## Files you were editing (newest first)\n${files.map((f) => `- ${f}`).join("\n")}`
    );
  if (s.todos?.length)
    parts.push(
      `## Your todo list\n${s.todos.map((t) => `- [${MARK[t.status]}] ${t.text}`).join("\n")}`
    );
  const requests = (s.requests ?? [])
    .map((r) => r.trim())
    // The task's own prompt is already above.
    .filter((r) => r && !(prompt && r.startsWith(prompt.slice(0, 200))));
  if (requests.length)
    parts.push(
      `## Latest from the reader\n${requests.map((r) => cut(r, MAX_REQUEST)).join("\n\n")}`
    );
  if (s.gitStatus?.trim())
    parts.push(`## git status\n${cut(s.gitStatus.trim(), 1_500)}`);
  if (!parts.length) return "";
  parts.push(
    "This note is from AgentOS, rebuilt from its own records after the context was compacted; the summary has the rest. Carry on from the next step. Don't re-read whole files you were editing (search for the spot), and edit in place rather than rewriting a whole file."
  );
  return cut(
    `(Your context was just compacted. Where you were:)\n\n${parts.join("\n\n")}`,
    MAX_NOTE
  );
}
