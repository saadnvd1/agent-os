import { db } from "@/lib/db";
import type { LeadArea, LeadAreaKind, LeadCharter, LeadKind } from "./types";

interface Row {
  workspace_id: string;
  lead_kind: string;
  title: string;
  area_text: string;
  charter_md: string;
  goal: string;
  updated_at: string;
}

export function getCharter(
  workspaceId: string,
  leadKind: LeadKind
): LeadCharter | null {
  const r = db
    .prepare(
      `SELECT * FROM lead_charters WHERE workspace_id = ? AND lead_kind = ?`
    )
    .get(workspaceId, leadKind) as Row | undefined;
  return r
    ? {
        workspaceId: r.workspace_id,
        leadKind: r.lead_kind,
        title: r.title,
        areaText: r.area_text,
        charterMd: r.charter_md,
        goal: r.goal,
        updatedAt: r.updated_at,
      }
    : null;
}

export function putCharter(
  c: Pick<LeadCharter, "workspaceId" | "leadKind" | "title"> &
    Partial<Pick<LeadCharter, "areaText" | "charterMd" | "goal">>
): LeadCharter {
  db.prepare(
    `INSERT INTO lead_charters (workspace_id, lead_kind, title, area_text, charter_md, goal)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, lead_kind) DO UPDATE SET
       title = excluded.title, area_text = excluded.area_text,
       charter_md = excluded.charter_md, goal = excluded.goal,
       updated_at = datetime('now')`
  ).run(
    c.workspaceId,
    c.leadKind,
    c.title,
    c.areaText ?? "",
    c.charterMd ?? "",
    c.goal ?? ""
  );
  return getCharter(c.workspaceId, c.leadKind)!;
}

export function leadAreas(workspaceId: string, leadKind: LeadKind): LeadArea[] {
  return db
    .prepare(
      `SELECT kind, value FROM lead_areas WHERE workspace_id = ? AND lead_kind = ?
       ORDER BY kind, value`
    )
    .all(workspaceId, leadKind) as LeadArea[];
}

// Replaces the lead's area in one step, so a reader never sees half of it.
export function setLeadAreas(
  workspaceId: string,
  leadKind: LeadKind,
  areas: LeadArea[]
): void {
  db.transaction(() => {
    db.prepare(
      `DELETE FROM lead_areas WHERE workspace_id = ? AND lead_kind = ?`
    ).run(workspaceId, leadKind);
    const insert = db.prepare(
      `INSERT OR IGNORE INTO lead_areas (workspace_id, lead_kind, kind, value)
       VALUES (?, ?, ?, ?)`
    );
    for (const a of areas) insert.run(workspaceId, leadKind, a.kind, a.value);
  })();
}

// The leads whose area holds this value (a project id, a path, a board).
export function leadsOwning(
  workspaceId: string,
  kind: LeadAreaKind,
  value: string
): LeadKind[] {
  return (
    db
      .prepare(
        `SELECT DISTINCT lead_kind FROM lead_areas
         WHERE workspace_id = ? AND kind = ? AND value = ? ORDER BY lead_kind`
      )
      .all(workspaceId, kind, value) as { lead_kind: string }[]
  ).map((r) => r.lead_kind);
}
