// Each terminal's OSC 7501 records, by tmux session name. In memory for the
// status map, and in SQLite so a restart keeps them.
import { getDb } from "../db";
import { getSessionIdFromName } from "../providers/registry";
import type { Report } from "./parse";
import {
  applyReport,
  dropTransient,
  summarize,
  type ProgramSummary,
  type Records,
} from "./records";

interface Store {
  records: Map<string, Records>;
  loaded: boolean;
}

// Shared by the custom server and the Next.js route bundles.
const g = globalThis as unknown as { __agentosProgramStatus?: Store };
const store: Store = (g.__agentosProgramStatus ??= {
  records: new Map(),
  loaded: false,
});

function load(): void {
  if (store.loaded) return;
  store.loaded = true;
  const rows = getDb()
    .prepare(`SELECT session_name, records FROM program_status`)
    .all() as { session_name: string; records: string }[];
  for (const row of rows) {
    try {
      store.records.set(row.session_name, JSON.parse(row.records) as Records);
    } catch {
      // A row this build can't read starts over empty.
    }
  }
}

export function programSummary(sessionName: string): ProgramSummary | null {
  load();
  return summarize(store.records.get(sessionName) ?? {});
}

const same = (a: ProgramSummary | null, b: ProgramSummary | null) =>
  a?.state === b?.state &&
  a?.kind === b?.kind &&
  a?.msg === b?.msg &&
  a?.progress === b?.progress &&
  a?.app === b?.app;

// Stores the records and says whether the session's status changed. A new
// working, blocked, done or error state moves the session's updated_at, the
// same as a terminal starting to wait does, so it sorts up and reads unread.
// Records as stored, without the times that change on every report.
const shape = (records: Records) =>
  JSON.stringify(Object.values(records).map(({ at: _at, ...r }) => r));

function commit(sessionName: string, next: Records): boolean {
  const before = programSummary(sessionName);
  const current = store.records.get(sessionName) ?? {};
  // The same report again (a hook firing on every tool call): keep its time
  // in memory, and touch nothing else.
  if (Object.keys(next).length > 0 && shape(next) === shape(current)) {
    store.records.set(sessionName, next);
    return false;
  }
  const db = getDb();
  if (Object.keys(next).length === 0) {
    store.records.delete(sessionName);
    db.prepare(`DELETE FROM program_status WHERE session_name = ?`).run(
      sessionName
    );
  } else {
    store.records.set(sessionName, next);
    db.prepare(
      `INSERT INTO program_status (session_name, records, updated_at)
         VALUES (?, ?, datetime('now'))
       ON CONFLICT(session_name) DO UPDATE
         SET records = excluded.records, updated_at = excluded.updated_at`
    ).run(sessionName, JSON.stringify(next));
  }
  const after = summarize(next);
  if (same(before, after)) return false;
  if (after && after.state !== "idle" && after.state !== before?.state)
    db.prepare(
      `UPDATE sessions SET updated_at = datetime('now') WHERE tmux_name = ? OR id = ?`
    ).run(sessionName, getSessionIdFromName(sessionName));
  return true;
}

export function applyProgramReport(
  sessionName: string,
  report: Report,
  foreground?: string
): boolean {
  load();
  const records = store.records.get(sessionName) ?? {};
  return commit(
    sessionName,
    applyReport(records, report, Date.now(), foreground)
  );
}

/** A shell prompt (no foreground given) or a new foreground program. */
export function dropProgramTransient(
  sessionName: string,
  foreground?: string,
  seenAt?: number
): boolean {
  load();
  const records = store.records.get(sessionName);
  if (!records) return false;
  const next = dropTransient(records, foreground, seenAt);
  if (Object.keys(next).length === Object.keys(records).length) return false;
  return commit(sessionName, next);
}

export function programSessions(): string[] {
  load();
  return [...store.records.keys()];
}

export function forgetProgramStatus(sessionName: string): void {
  load();
  if (store.records.has(sessionName)) commit(sessionName, {});
}

/** Forget what's in memory; the next read loads the table again. */
export function reloadProgramStatus(): void {
  store.records.clear();
  store.loaded = false;
}
