/**
 * Where audits are kept: outside every repo, because they quote private
 * session content. ~/.agent-os/audits/<kind>/ holds one folder per kind of
 * audit. Session audits are in sessions/: <id>.md is the report, <id>.json
 * its findings, <id>.summary.json/.md the extractor's numbers, and
 * index.json the list. Other kinds are markdown files with optional
 * frontmatter. Nothing is ever deleted; each audit compares itself to the
 * one before.
 */

import fs from "fs";
import os from "os";
import path from "path";
import type { Summary } from "./aggregate";

export const AUDIT_ID = /^\d{4}-\d{2}-\d{2}-\d{4}$/;
/** A kind of audit, and a report's name within it: never a path. */
export const AUDIT_NAME = /^[a-z0-9][a-z0-9-]{0,80}$/;
export const SESSIONS_KIND = "sessions";

export function auditsRoot(): string {
  return (
    process.env.AGENTOS_AUDITS_DIR ||
    path.join(os.homedir(), ".agent-os", "audits")
  );
}

export function auditsDir(): string {
  return path.join(auditsRoot(), SESSIONS_KIND);
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
  kind?: string;
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

/** The last audit before this one: re-running an audit doesn't compare it with itself. */
export function latestAudit(except?: string): AuditIndexEntry | null {
  const list = readIndex().filter(
    (e) => e.id !== except && (!except || e.id < except)
  );
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

/** One audit in the list AgentOS shows, of any kind. */
export interface AuditListItem {
  kind: string;
  id: string;
  at: string;
  title: string;
  headline: string;
  sessions?: number;
  tokensRead?: number;
  findings?: number;
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;

function frontmatter(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const m = text.match(FRONTMATTER);
  for (const line of m?.[1].split("\n") ?? []) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const stripFrontmatter = (text: string) => text.replace(FRONTMATTER, "");

/** Every audit of every kind, newest first. */
export function listAudits(): AuditListItem[] {
  const items: AuditListItem[] = readIndex().map((e) => ({
    kind: SESSIONS_KIND,
    id: e.id,
    at: e.at,
    title: "Session audit",
    headline: e.headline || e.top[0] || "",
    sessions: e.sessions,
    tokensRead: e.tokensRead,
    findings: e.findings,
  }));
  let kinds: string[] = [];
  try {
    kinds = fs
      .readdirSync(auditsRoot())
      .filter((k) => k !== SESSIONS_KIND && AUDIT_NAME.test(k));
  } catch {
    // No audits yet.
  }
  for (const kind of kinds) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(path.join(auditsRoot(), kind));
    } catch {
      continue;
    }
    for (const name of names) {
      const id = name.replace(/\.md$/, "");
      if (!name.endsWith(".md") || !AUDIT_NAME.test(id) || id === "readme")
        continue;
      const file = path.join(auditsRoot(), kind, name);
      try {
        const text = fs.readFileSync(file, "utf8");
        const meta = frontmatter(text);
        const body = stripFrontmatter(text);
        const parsed = Date.parse(meta.audited ?? "");
        items.push({
          kind,
          id,
          at: Number.isNaN(parsed)
            ? fs.statSync(file).mtime.toISOString()
            : new Date(parsed).toISOString(),
          title:
            body
              .match(/^#\s+(.+)$/m)?.[1]
              .trim()
              .slice(0, 160) ?? `${kind} audit`,
          headline: "",
        });
      } catch {
        // Unreadable: left out rather than failing the list.
      }
    }
  }
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

/** One audit's report, frontmatter removed; null when there is none. */
export function readAuditReport(kind: string, id: string): string | null {
  if (kind === SESSIONS_KIND) return AUDIT_ID.test(id) ? readReport(id) : null;
  if (!AUDIT_NAME.test(kind) || !AUDIT_NAME.test(id)) return null;
  try {
    return stripFrontmatter(
      fs.readFileSync(path.join(auditsRoot(), kind, `${id}.md`), "utf8")
    );
  } catch {
    return null;
  }
}
