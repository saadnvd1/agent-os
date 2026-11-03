import { getDb } from "@/lib/db";

// The workspace a session belongs to: its project's, else the one kept on the
// session (an orchestrator, or a scratch session in no project). Same rule as
// inWorkspace in lib/sidebar/shelves, read from the database.
export function sessionWorkspaceId(
  sessionId: string
): string | null | undefined {
  const row = getDb()
    .prepare(
      `SELECT s.role AS role, s.workspace_id AS own, p.workspace_id AS byProject
       FROM sessions s LEFT JOIN projects p ON p.id = s.project_id
       WHERE s.id = ?`
    )
    .get(sessionId) as
    | { role: string | null; own: string | null; byProject: string | null }
    | undefined;
  if (!row) return undefined;
  if (row.role === "orchestrator") return row.own;
  return row.byProject ?? row.own;
}
