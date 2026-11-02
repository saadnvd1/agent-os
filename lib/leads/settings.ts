import { db } from "@/lib/db";
import type { ChiefAutonomy, WorkspaceLeads } from "./types";

interface Row {
  workspace_id: string;
  enabled_at: string;
  chief_autonomy: ChiefAutonomy;
}

const view = (r: Row): WorkspaceLeads => ({
  workspaceId: r.workspace_id,
  enabledAt: r.enabled_at,
  chiefAutonomy: r.chief_autonomy,
});

// Whether "Add leads" ran on this workspace. The experiment switch alone
// creates nothing; a workspace without this row is exactly as before.
export function workspaceLeads(workspaceId: string): WorkspaceLeads | null {
  const row = db
    .prepare(`SELECT * FROM workspace_leads WHERE workspace_id = ?`)
    .get(workspaceId) as Row | undefined;
  return row ? view(row) : null;
}

export const hasLeads = (workspaceId: string | null | undefined): boolean =>
  !!workspaceId && !!workspaceLeads(workspaceId);

export function workspacesWithLeads(): WorkspaceLeads[] {
  return (
    db
      .prepare(`SELECT * FROM workspace_leads ORDER BY enabled_at`)
      .all() as Row[]
  ).map(view);
}

export function markLeadsEnabled(workspaceId: string): WorkspaceLeads {
  db.prepare(
    `INSERT INTO workspace_leads (workspace_id) VALUES (?)
     ON CONFLICT(workspace_id) DO NOTHING`
  ).run(workspaceId);
  return workspaceLeads(workspaceId)!;
}

export function setChiefAutonomy(
  workspaceId: string,
  autonomy: ChiefAutonomy
): boolean {
  return (
    db
      .prepare(
        `UPDATE workspace_leads SET chief_autonomy = ? WHERE workspace_id = ?`
      )
      .run(autonomy, workspaceId).changes > 0
  );
}
