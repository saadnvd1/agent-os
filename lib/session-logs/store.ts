import { db } from "../db";

// What the list and the orchestrator's tool show of a log without its text.
export interface LogHeader {
  id: string;
  name: string;
  workspace: string | null;
  project: string | null;
  branch: string | null;
  prNumber: number | null;
  prUrl: string | null;
  mergeCommit: string | null;
  startedAt: string | null;
  mergedAt: string | null;
  durationMs: number | null;
  costUsd: number;
  planKept: boolean;
  hasPlan: boolean;
  createdAt: string;
  filePath: string | null;
}

export interface LogRow {
  session_id: string;
  project_id: string | null;
  workspace_id: string | null;
  created_at: string;
  markdown: string;
  data: string;
  file_path: string | null;
}

export const hasLog = (sessionId: string): boolean =>
  !!db
    .prepare(`SELECT 1 FROM session_logs WHERE session_id = ?`)
    .get(sessionId);

export function getLog(sessionId: string): LogRow | null {
  return (
    (db
      .prepare(`SELECT * FROM session_logs WHERE session_id = ?`)
      .get(sessionId) as LogRow | undefined) ?? null
  );
}

// True when this call stored it: a log already there is never replaced.
export function insertLog(row: {
  sessionId: string;
  projectId: string | null;
  workspaceId: string | null;
  markdown: string;
  header: Omit<LogHeader, "createdAt" | "filePath">;
  filePath: string | null;
}): boolean {
  return (
    db
      .prepare(
        `INSERT OR IGNORE INTO session_logs
           (session_id, project_id, workspace_id, markdown, data, file_path)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.sessionId,
        row.projectId,
        row.workspaceId,
        row.markdown,
        JSON.stringify(row.header),
        row.filePath
      ).changes > 0
  );
}

// Replaces the text and header of a log that exists; the row stays.
export function updateLog(
  sessionId: string,
  markdown: string,
  header: Omit<LogHeader, "createdAt" | "filePath">
): void {
  db.prepare(
    `UPDATE session_logs SET markdown = ?, data = ? WHERE session_id = ?`
  ).run(markdown, JSON.stringify(header), sessionId);
}

export function setFilePath(sessionId: string, filePath: string): void {
  db.prepare(`UPDATE session_logs SET file_path = ? WHERE session_id = ?`).run(
    filePath,
    sessionId
  );
}

const toHeader = (r: LogRow): LogHeader => ({
  ...(JSON.parse(r.data) as LogHeader),
  createdAt: r.created_at,
  filePath: r.file_path,
});

export const headerOf = (r: LogRow): LogHeader => toHeader(r);

// Newest merge first.
export function listLogs(
  where: { projectId?: string; workspaceId?: string },
  limit = 50
): LogHeader[] {
  const rows = db
    .prepare(
      `SELECT * FROM session_logs
       WHERE (@p IS NULL OR project_id = @p) AND (@w IS NULL OR workspace_id = @w)
       ORDER BY json_extract(data, '$.mergedAt') DESC, created_at DESC LIMIT @n`
    )
    .all({
      p: where.projectId ?? null,
      w: where.workspaceId ?? null,
      n: Math.max(1, Math.min(limit, 500)),
    }) as LogRow[];
  return rows.map(toHeader);
}
