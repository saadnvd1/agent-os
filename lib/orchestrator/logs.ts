/**
 * The orchestrator's `logs` tool: session logs read from the database as
 * they were written. Reading only; nothing here asks a model to summarise.
 */

import { formatDuration } from "../session-logs/build";
import { getLog, listLogs, type LogHeader } from "../session-logs";
import { db } from "../db";
import { workspaceProject } from "./targets";
import { untrusted } from "./untrusted";

// About 8k tokens: what one full log may return.
export const LOG_CHAR_CAP = 30000;

const headerLine = (h: LogHeader) =>
  [
    (h.mergedAt ?? h.createdAt).slice(0, 10),
    `${h.name} [${h.id.slice(0, 8)}]`,
    h.project ?? "no project",
    h.prNumber ? `#${h.prNumber}` : "no PR",
    h.durationMs !== null ? formatDuration(h.durationMs) : "?",
    `$${h.costUsd.toFixed(2)}`,
    h.hasPlan ? "plan" : h.planKept ? "no plan" : "plan not kept",
  ].join(" · ");

function findOne(
  workspaceId: string,
  projectId: string | null,
  ref: string
): string {
  const r = ref.trim().toLowerCase();
  const pr = /^#?(\d+)$/.exec(r);
  const rows = db
    .prepare(
      `SELECT session_id AS id, json_extract(data, '$.name') AS name,
         json_extract(data, '$.prNumber') AS pr
       FROM session_logs WHERE workspace_id = ? AND (? IS NULL OR project_id = ?)
       ORDER BY json_extract(data, '$.mergedAt') DESC`
    )
    .all(workspaceId, projectId, projectId) as {
    id: string;
    name: string;
    pr: number | null;
  }[];
  const hit = rows.filter(
    (x) =>
      x.id === ref ||
      x.id.startsWith(r) ||
      x.name.toLowerCase() === r ||
      (pr !== null && x.pr === Number(pr[1]))
  );
  if (hit.length === 1) return hit[0].id;
  if (hit.length > 1)
    throw new Error(
      `"${ref}" matches ${hit.length} logs (${hit.map((x) => x.id.slice(0, 8)).join(", ")}); use an id`
    );
  throw new Error(`No log for "${ref}" in this workspace.`);
}

export function readLogs(
  workspaceId: string,
  a: { project?: string; task?: string; n?: number }
): string {
  const projectId = a.project
    ? workspaceProject(workspaceId, a.project).id
    : null;
  if (a.task) {
    const row = getLog(findOne(workspaceId, projectId, a.task))!;
    const md =
      row.markdown.length > LOG_CHAR_CAP
        ? `${row.markdown.slice(0, LOG_CHAR_CAP)}\n… (trimmed; ${row.markdown.length} characters in all)`
        : row.markdown;
    return untrusted("session log", md);
  }
  const logs = listLogs(
    { workspaceId, ...(projectId ? { projectId } : {}) },
    a.n ?? 10
  );
  if (!logs.length) return "No session logs yet.";
  return untrusted("session logs", logs.map(headerLine).join("\n"));
}
