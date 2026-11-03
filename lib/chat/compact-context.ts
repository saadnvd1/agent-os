/**
 * The note an agent gets back right after a compaction, gathered from
 * AgentOS's records (lib/chat/working-state has the rules). From the
 * database each time rather than tracked in memory, so it is right after a
 * deploy restarted the worker too.
 */

import os from "node:os";
import { statusPorcelain } from "../git-exec";
import { db, type Session } from "../db";
import { amendmentsOf } from "../orchestrator/amendments";
import { lastItems } from "./store";
import { workingStateNote } from "./working-state";

async function gitStatus(cwd: string): Promise<string> {
  try {
    const out = await statusPorcelain(cwd, {
      timeout: 3_000,
      maxBuffer: 64 * 1024,
    });
    return out.split("\n").slice(0, 40).join("\n");
  } catch {
    return "";
  }
}

// Empty when the session is gone or there is nothing to say.
export async function compactContext(sessionId: string): Promise<string> {
  const session = db
    .prepare(
      `SELECT working_directory, task_prompt, role FROM session_rows WHERE id = ?`
    )
    .get(sessionId) as
    Pick<Session, "working_directory" | "task_prompt" | "role"> | undefined;
  // An orchestrator starts fresh instead of compacting.
  if (!session || session.role === "orchestrator") return "";
  const tools = lastItems(sessionId, 400, "tool").filter(
    (i) => i.kind === "tool"
  );
  const todos = lastItems(sessionId, 1, "todos").find(
    (i) => i.kind === "todos"
  );
  const user = lastItems(sessionId, 1, "user").find((i) => i.kind === "user");
  return workingStateNote({
    taskPrompt: session.task_prompt,
    amendments: amendmentsOf(sessionId).map((a) => a.text),
    tools,
    todos: todos?.todos,
    requests: user ? [user.text] : [],
    gitStatus: await gitStatus(
      session.working_directory.replace(/^~/, os.homedir())
    ),
  });
}
