import { db } from "../db";
import type {
  DraftStatus,
  HealthReport,
  ReportSummary,
  ReportTrigger,
} from "./types";

interface Row {
  id: number;
  session_id: string;
  workspace_id: string | null;
  head: string | null;
  trigger: ReportTrigger;
  evidence_hash: string;
  data: string;
  model: string | null;
  cost_usd: number | null;
  draft_text: string | null;
  draft_status: DraftStatus | null;
  created_at: string;
}

// What is stored in `data`: the report without what the row itself holds.
type Stored = Omit<
  HealthReport,
  "id" | "sessionId" | "workspaceId" | "createdAt" | "stale" | "draft"
> & { draft: HealthReport["draft"] };

export function insertReport(
  r: Omit<HealthReport, "id" | "createdAt" | "stale">,
  hash: string
): number {
  const { id: _i, sessionId, workspaceId, ...rest } = r as HealthReport;
  void _i;
  const draft = r.draft?.source === "report" ? r.draft : null;
  db.prepare(
    `UPDATE health_reports SET draft_status = 'superseded'
      WHERE session_id = ? AND draft_status = 'pending'`
  ).run(sessionId);
  const info = db
    .prepare(
      `INSERT INTO health_reports (session_id, workspace_id, head, trigger, evidence_hash, data, model, cost_usd, draft_text, draft_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      sessionId,
      workspaceId,
      r.head,
      r.trigger,
      hash,
      JSON.stringify({ ...rest, draft: null } satisfies Stored),
      r.model,
      r.costUsd,
      draft?.text ?? null,
      draft ? "pending" : null
    );
  return Number(info.lastInsertRowid);
}

function toReport(row: Row, head: string | null | undefined): HealthReport {
  const data = JSON.parse(row.data) as Stored;
  return {
    ...data,
    id: row.id,
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    createdAt: row.created_at,
    draft: row.draft_text
      ? {
          source: "report",
          id: String(row.id),
          text: row.draft_text,
          status: row.draft_status ?? "pending",
        }
      : null,
    stale: head !== undefined && head !== row.head,
  };
}

// `head` is the task's current head, to mark an older report stale.
export function latestReport(
  sessionId: string,
  head?: string | null
): HealthReport | null {
  const row = db
    .prepare(
      `SELECT * FROM health_reports WHERE session_id = ? ORDER BY id DESC LIMIT 1`
    )
    .get(sessionId) as Row | undefined;
  return row ? toReport(row, head) : null;
}

export function getReport(id: number): HealthReport | null {
  const row = db
    .prepare(`SELECT * FROM health_reports WHERE id = ?`)
    .get(id) as Row | undefined;
  return row ? toReport(row, undefined) : null;
}

export function hashOfLatest(sessionId: string): string | null {
  const row = db
    .prepare(
      `SELECT evidence_hash FROM health_reports WHERE session_id = ? ORDER BY id DESC LIMIT 1`
    )
    .get(sessionId) as { evidence_hash: string } | undefined;
  return row?.evidence_hash ?? null;
}

// Claimed first, so a double tap sends once.
export function claimDraft(
  reportId: number,
  to: Exclude<DraftStatus, "pending">
): boolean {
  return (
    db
      .prepare(
        `UPDATE health_reports SET draft_status = ?, draft_decided_at = datetime('now')
          WHERE id = ? AND draft_status = 'pending'`
      )
      .run(to, reportId).changes === 1
  );
}

export function reopenDraft(reportId: number): void {
  db.prepare(
    `UPDATE health_reports SET draft_status = 'pending', draft_decided_at = NULL
      WHERE id = ? AND draft_status = 'sent'`
  ).run(reportId);
}

export function setDraftText(
  reportId: number,
  text: string,
  status: DraftStatus
) {
  db.prepare(
    `UPDATE health_reports SET draft_text = ?, draft_status = ? WHERE id = ?`
  ).run(text, status, reportId);
}

export function historyOf(sessionId: string, limit = 20): ReportSummary[] {
  const rows = db
    .prepare(
      `SELECT * FROM health_reports WHERE session_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(sessionId, limit) as Row[];
  return rows.map((r) => summaryOf(toReport(r, undefined), ""));
}

export function summaryOf(r: HealthReport, name: string): ReportSummary {
  return {
    sessionId: r.sessionId,
    name,
    headline: r.headline,
    state: r.state,
    estimate: {
      done: r.estimate.done,
      total: r.estimate.total,
      basis: r.estimate.basis,
    },
    createdAt: r.createdAt,
  };
}

// The newest report of each task in a workspace.
export function latestByTask(
  workspaceId: string
): { report: HealthReport; name: string }[] {
  const rows = db
    .prepare(
      `SELECT h.*, s.name AS name FROM health_reports h
         JOIN session_rows s ON s.id = h.session_id
        WHERE h.workspace_id = ?
          AND h.id = (SELECT MAX(id) FROM health_reports WHERE session_id = h.session_id)
        ORDER BY h.id DESC LIMIT 100`
    )
    .all(workspaceId) as (Row & { name: string })[];
  return rows.map((r) => ({ report: toReport(r, undefined), name: r.name }));
}
