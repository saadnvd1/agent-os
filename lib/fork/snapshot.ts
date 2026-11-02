/**
 * What a child that can't have a copy of the conversation is told about
 * where its parent stands: built from AgentOS's own records, the same pieces
 * as the note after a compaction (lib/chat/compact-context).
 */

import os from "node:os";
import { db, type Session } from "../db";
import { statusPorcelain } from "../git-exec";
import { lastItems } from "../chat/store";
import { editedFiles } from "../chat/working-state";

const EXCHANGES = 6;
const CLIP = 700;
const MAX = 10_000;

const clip = (text: string, max = CLIP) =>
  text.length > max ? `${text.slice(0, max)}…` : text;

export async function parentSnapshot(parentId: string): Promise<string> {
  const session = db
    .prepare(
      `SELECT name, working_directory, task_prompt FROM session_rows WHERE id = ?`
    )
    .get(parentId) as
    Pick<Session, "name" | "working_directory" | "task_prompt"> | undefined;
  if (!session) return "";
  const parts: string[] = [`Parent session: ${session.name}`];
  if (session.task_prompt?.trim())
    parts.push(`## Its task\n${clip(session.task_prompt, 4_000)}`);
  const said = lastItems(parentId, 60)
    .filter((i) => i.kind === "user" || i.kind === "assistant")
    .slice(-EXCHANGES * 2)
    .map((i) =>
      i.kind === "user"
        ? `User: ${clip(i.text)}`
        : i.kind === "assistant"
          ? `Agent: ${clip(i.text)}`
          : ""
    )
    .filter(Boolean);
  if (said.length) parts.push(`## The latest exchanges\n${said.join("\n\n")}`);
  const todos = lastItems(parentId, 1, "todos").find((i) => i.kind === "todos");
  if (todos?.kind === "todos" && todos.todos.length)
    parts.push(
      `## Its todo list\n${todos.todos.map((t) => `- [${t.status}] ${t.text}`).join("\n")}`
    );
  const files = editedFiles(
    lastItems(parentId, 400, "tool").filter((i) => i.kind === "tool")
  );
  if (files.length)
    parts.push(
      `## Files it was editing\n${files.map((f) => `- ${f}`).join("\n")}`
    );
  try {
    const status = await statusPorcelain(
      session.working_directory.replace(/^~/, os.homedir()),
      { timeout: 3_000, maxBuffer: 64 * 1024 }
    );
    if (status.trim())
      parts.push(
        `## git status\n${status.split("\n").slice(0, 40).join("\n")}`
      );
  } catch {
    // Not a repository, or git is slow: the rest stands.
  }
  const text = parts.join("\n\n");
  return text.length > MAX ? `${text.slice(0, MAX)}\n… (cut)` : text;
}
