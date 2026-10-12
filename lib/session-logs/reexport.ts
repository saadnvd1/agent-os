/**
 * Rewrites the files of logs already in the database to where they'd go
 * now, from the stored markdown: no rebuild, no model. The old files are
 * left alone. A log whose file is already in its destination is skipped, so
 * a second run changes nothing.
 */

import path from "path";
import { db } from "../db";
import { destination, writeLogFileTo } from "./folder";
import { commitLogs } from "./hq";
import { headerOf, setFilePath, type LogRow } from "./store";

export interface ReexportResult {
  moved: number;
  unchanged: number;
  failed: number;
  committed: number;
}

export async function reexportLogs(
  opts: { dry?: boolean; log?: (line: string) => void } = {}
): Promise<ReexportResult> {
  const log = opts.log ?? (() => {});
  const rows = db
    .prepare(
      `SELECT * FROM session_logs
       ORDER BY json_extract(data, '$.mergedAt'), created_at`
    )
    .all() as LogRow[];
  const result: ReexportResult = {
    moved: 0,
    unchanged: 0,
    failed: 0,
    committed: 0,
  };
  const byHq = new Map<
    string,
    { files: string[]; visibility: "private" | "internal" | "none" }
  >();
  for (const row of rows) {
    const h = headerOf(row);
    const target = {
      workspace: h.workspace,
      workspaceId: row.workspace_id,
      project: h.project,
      projectId: row.project_id,
      name: h.name,
      id: row.session_id,
      day: (h.mergedAt ?? row.created_at).slice(0, 10),
    };
    try {
      const dest = destination(target);
      if (row.file_path && path.dirname(row.file_path) === dest.dir) {
        result.unchanged++;
        continue;
      }
      if (opts.dry) {
        log(`  would move ${h.name} to ${dest.dir}`);
        result.moved++;
        continue;
      }
      const { file, hq } = writeLogFileTo(target, row.markdown);
      setFilePath(row.session_id, file);
      if (hq) {
        const entry = byHq.get(hq.dir) ?? {
          files: [],
          visibility: hq.visibility,
        };
        entry.files.push(file);
        byHq.set(hq.dir, entry);
      }
      result.moved++;
      log(`  wrote ${file}`);
    } catch (error) {
      result.failed++;
      log(`  FAILED ${h.name} (${row.session_id.slice(0, 8)}): ${error}`);
    }
  }
  for (const [hq, { files, visibility }] of byHq) {
    await commitLogs(
      hq,
      files,
      `session logs: ${files.length} moved in`,
      visibility
    );
    result.committed += files.length;
  }
  return result;
}
