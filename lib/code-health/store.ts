/**
 * Code-health audits live beside session audits, outside the repo (it is
 * public and an audit is not): ~/.agent-os/audits/code-health/ holds
 * <id>.prepass.json (the script's numbers), <id>.md (the report, with
 * frontmatter), <id>.json (its findings) and index.json (the list).
 */

import fs from "fs";
import path from "path";
import {
  AUDIT_ID,
  auditsRoot,
  writeAtomic,
  type AuditFindings,
} from "../session-audit/store";
import type { Prepass } from "./summary";

export const CODE_HEALTH_KIND = "code-health";

export interface CodeHealthIndexEntry {
  id: string;
  kind: typeof CODE_HEALTH_KIND;
  at: string;
  commit: string;
  headline: string;
  findings: number;
  top: string[];
}

export const codeHealthDir = () => path.join(auditsRoot(), CODE_HEALTH_KIND);

export function codeHealthFile(id: string, ext: string): string {
  if (!AUDIT_ID.test(id)) throw new Error(`Bad audit id: ${id}`);
  return path.join(codeHealthDir(), `${id}${ext}`);
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export function readCodeHealthIndex(): CodeHealthIndexEntry[] {
  const list = readJson<unknown>(path.join(codeHealthDir(), "index.json"));
  return Array.isArray(list)
    ? list.filter((e) => e && AUDIT_ID.test(e.id))
    : [];
}

/** The last recorded audit before `except`, so a re-run never compares with itself. */
export function latestCodeHealth(except?: string): CodeHealthIndexEntry | null {
  const list = readCodeHealthIndex().filter((e) => !except || e.id < except);
  return list.length ? list[list.length - 1] : null;
}

export const readPrepass = (id: string) =>
  readJson<Prepass>(codeHealthFile(id, ".prepass.json"));

export const readCodeHealthFindings = (id: string) =>
  readJson<AuditFindings>(codeHealthFile(id, ".json"));

export function writePrepass(prepass: Prepass) {
  writeAtomic(
    codeHealthFile(prepass.id, ".prepass.json"),
    JSON.stringify(prepass, null, 1)
  );
}

/**
 * Lists a finished audit. Refuses one without its pre-pass, report or a
 * well-formed findings file, so the list never links to half an audit.
 */
export function recordCodeHealth(id: string): CodeHealthIndexEntry {
  const prepass = readPrepass(id);
  if (!prepass) throw new Error(`No pre-pass for ${id}: run prepass first`);
  const report = codeHealthFile(id, ".md");
  if (!fs.existsSync(report)) throw new Error(`No report at ${report}`);
  const meta = fs
    .readFileSync(report, "utf8")
    .match(/^---\n([\s\S]*?)\n---/)?.[1];
  if (!meta || !/^audited:/m.test(meta))
    throw new Error("The report needs frontmatter with an audited: time");
  const findings = readCodeHealthFindings(id);
  if (
    !findings ||
    !Array.isArray(findings.findings) ||
    findings.findings.some((f) => !f?.key || !f?.title)
  )
    throw new Error(
      `Findings at ${codeHealthFile(id, ".json")} need a findings array, each with a key and a title`
    );
  const entry: CodeHealthIndexEntry = {
    id,
    kind: CODE_HEALTH_KIND,
    at: prepass.generatedAt,
    commit: prepass.commit,
    headline: String(findings.headline ?? "").slice(0, 300),
    findings: findings.findings.length,
    top: findings.findings
      .slice(0, 3)
      .map((f) => String(f.title).slice(0, 160)),
  };
  const list = readCodeHealthIndex().filter((e) => e.id !== id);
  list.push(entry);
  list.sort((a, b) => a.id.localeCompare(b.id));
  writeAtomic(
    path.join(codeHealthDir(), "index.json"),
    JSON.stringify(list, null, 1)
  );
  return entry;
}
