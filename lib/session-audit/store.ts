/**
 * Where audits are kept: outside every repo, because they quote private
 * session content. ~/.agent-os/audits/<id>.md is the report, <id>.json its
 * findings, <id>.summary.json/.md the extractor's numbers, and index.json the
 * list AgentOS shows. Nothing is ever deleted; each audit compares itself to
 * the one before.
 */

import fs from "fs";
import os from "os";
import path from "path";
import type { Summary } from "./aggregate";

export const AUDIT_ID = /^\d{4}-\d{2}-\d{2}-\d{4}$/;

export function auditsDir(): string {
  return (
    process.env.AGENTOS_AUDITS_DIR ||
    path.join(os.homedir(), ".agent-os", "audits")
  );
}

export interface AuditFinding {
  /** Stable across audits, so the next one can say whether it persists. */
  key: string;
  title: string;
  category: string;
  priority: string;
  effort: string;
  status?: string;
  estTokensSaved?: number | null;
}

export interface AuditFindings {
  id: string;
  headline: string;
  findings: AuditFinding[];
  resolved?: string[];
}

export interface AuditIndexEntry {
  id: string;
  at: string;
  since: string;
  until: string;
  sessions: number;
  tokensRead: number;
  headline: string;
  findings: number;
  top: string[];
}

const file = (id: string, ext: string) => {
  if (!AUDIT_ID.test(id)) throw new Error(`Bad audit id: ${id}`);
  return path.join(auditsDir(), `${id}${ext}`);
};

/** An audit's id: the local time it ran, to the minute. */
export function auditId(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}

function writeAtomic(target: string, text: string) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, target);
}

export function readIndex(): AuditIndexEntry[] {
  try {
    const list = JSON.parse(
      fs.readFileSync(path.join(auditsDir(), "index.json"), "utf8")
    );
    return Array.isArray(list)
      ? list.filter((e) => e && AUDIT_ID.test(e.id))
      : [];
  } catch {
    return [];
  }
}

export function latestAudit(): AuditIndexEntry | null {
  const list = readIndex();
  return list.length ? list[list.length - 1] : null;
}

export function readReport(id: string): string | null {
  try {
    return fs.readFileSync(file(id, ".md"), "utf8");
  } catch {
    return null;
  }
}

export function readSummary(id: string): Summary | null {
  try {
    return JSON.parse(fs.readFileSync(file(id, ".summary.json"), "utf8"));
  } catch {
    return null;
  }
}

export function writeSummary(id: string, summary: Summary, markdown: string) {
  writeAtomic(file(id, ".summary.json"), JSON.stringify(summary, null, 1));
  writeAtomic(file(id, ".summary.md"), markdown);
}

/**
 * Adds a finished audit to the index once its report and findings are
 * written. Refuses an audit that isn't complete, so the list never links to
 * a report that isn't there.
 */
export function recordAudit(id: string): AuditIndexEntry {
  if (!AUDIT_ID.test(id)) throw new Error(`Bad audit id: ${id}`);
  const summary = readSummary(id);
  if (!summary) throw new Error(`No summary for ${id}: run extract first`);
  if (readReport(id) === null)
    throw new Error(`No report at ${file(id, ".md")}`);
  let findings: AuditFindings;
  try {
    findings = JSON.parse(fs.readFileSync(file(id, ".json"), "utf8"));
  } catch (error) {
    throw new Error(
      `Unreadable findings at ${file(id, ".json")}: ${(error as Error).message}`
    );
  }
  if (
    !Array.isArray(findings.findings) ||
    findings.findings.some((f) => !f?.key || !f?.title)
  )
    throw new Error(
      "Findings need a findings array, each with a key and a title"
    );

  const entry: AuditIndexEntry = {
    id,
    at: summary.generatedAt,
    since: summary.range.since,
    until: summary.range.until,
    sessions: summary.totals.sessions,
    tokensRead: summary.totals.tokensRead + summary.totals.subagentTokensRead,
    headline: String(findings.headline ?? "").slice(0, 300),
    findings: findings.findings.length,
    top: findings.findings
      .slice(0, 3)
      .map((f) => String(f.title).slice(0, 160)),
  };
  const list = readIndex().filter((e) => e.id !== id);
  list.push(entry);
  list.sort((a, b) => a.id.localeCompare(b.id));
  writeAtomic(
    path.join(auditsDir(), "index.json"),
    JSON.stringify(list, null, 1)
  );
  return entry;
}

export function readFindings(id: string): AuditFindings | null {
  try {
    return JSON.parse(fs.readFileSync(file(id, ".json"), "utf8"));
  } catch {
    return null;
  }
}
