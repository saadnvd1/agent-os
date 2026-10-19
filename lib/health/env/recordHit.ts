import { db } from "@/lib/db";
import type { ChatItem } from "@/lib/chat/events";
import { classifyToolResult } from "./classify";
import type { EnvHit } from "./types";

type ToolItem = Extract<ChatItem, { kind: "tool" }>;

// One row per session and class; the same item seen again doesn't count.
export function recordHit(
  sessionId: string,
  itemId: string,
  hit: EnvHit,
  now = Date.now()
): void {
  const s = db
    .prepare(
      `SELECT r.project_id, COALESCE(r.workspace_id, p.workspace_id) AS ws
       FROM session_rows r LEFT JOIN projects p ON p.id = r.project_id
       WHERE r.id = ?`
    )
    .get(sessionId) as
    { project_id: string | null; ws: string | null } | undefined;
  db.prepare(
    `INSERT INTO env_failures
       (session_id, class, project_id, workspace_id, command, line,
        last_item_id, first_at, last_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id, class) DO UPDATE SET
       hits = hits + (excluded.last_item_id IS NOT last_item_id),
       last_at = excluded.last_at, last_item_id = excluded.last_item_id,
       command = excluded.command, line = excluded.line`
  ).run(
    sessionId,
    hit.class,
    s?.project_id ?? null,
    s?.ws ?? null,
    hit.command,
    hit.line,
    itemId,
    now,
    now
  );
}

// The runner's entry point for every tool item. It must never throw into
// the chat, and a call still running has no result to read yet.
export function noteToolResult(sessionId: string, item: ToolItem): void {
  if (item.status !== "done" && item.status !== "error") return;
  if (!item.output) return;
  try {
    const hit = classifyToolResult({
      tool: item.name,
      input: item.input,
      output: item.output,
      status: item.status,
    });
    if (hit) recordHit(sessionId, item.id, hit);
  } catch (error) {
    console.error(`[env-failures] ${sessionId}:`, error);
  }
}
