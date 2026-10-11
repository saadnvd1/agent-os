/**
 * The /session-audit skill's data tool. It reads AgentOS's database (read
 * only) and the transcripts of the sessions AgentOS started, and writes a
 * compact summary to ~/.agent-os/audits; the skill reads only that.
 *
 *   npx tsx scripts/session-audit/audit.ts extract [--since today|YYYY-MM-DD|ISO] [--until …] [--db path]
 *   npx tsx scripts/session-audit/audit.ts excerpt --session <id prefix> --match <regex> [--limit 5]
 *   npx tsx scripts/session-audit/audit.ts record <audit id>
 *   npx tsx scripts/session-audit/audit.ts list
 *
 * --since defaults to where the last audit ended (today's midnight if none).
 */

import path from "path";
import {
  summarize,
  type SessionInput,
} from "../../lib/session-audit/aggregate";
import { compare, renderSummary } from "../../lib/session-audit/render";
import {
  loadSessions,
  loadSignals,
  openDb,
  subagentFiles,
} from "../../lib/session-audit/sources";
import {
  auditId,
  auditsDir,
  latestAudit,
  readFindings,
  readIndex,
  readSummary,
  recordAudit,
  writeSummary,
} from "../../lib/session-audit/store";
import {
  findExcerpts,
  scanTranscript,
  type Range,
} from "../../lib/session-audit/transcript";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

/** A time from the command line: "today", "now", a local date, or an ISO time. */
export function parseTime(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  if (value === "now") return Date.now();
  if (value === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  // A bare date is local midnight, the way Saad reads a day.
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`).getTime()
    : Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`Can't read the time "${value}"`);
  return ms;
}

function dbPath(args: string[]): string {
  return path.resolve(flag(args, "db") || process.env.DB_PATH || "agent-os.db");
}

function range(args: string[]): Range {
  const last = latestAudit();
  const today = parseTime("today", 0);
  const since = parseTime(
    flag(args, "since"),
    last ? Date.parse(last.until) : today
  );
  const until = parseTime(flag(args, "until"), Date.now());
  if (until <= since) throw new Error("--until must be after --since");
  return { since, until };
}

// Transcripts are read a few at a time: streaming keeps memory flat, and a
// small pool keeps the disk busy without loading the machine.
async function pool<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

async function extract(args: string[]) {
  const started = Date.now();
  const r = range(args);
  const db = openDb(dbPath(args));
  const sessions = loadSessions(db, r.since);
  const signals = loadSignals(
    db,
    r.since,
    r.until,
    new Set(sessions.map((s) => s.id))
  );
  db.close();

  const inputs: SessionInput[] = await pool(sessions, 4, async (session) => {
    const main = [];
    const subagents = [];
    for (const file of session.files) {
      main.push(await scanTranscript(file, r));
      for (const sub of subagentFiles(file, r.since))
        subagents.push({
          type: sub.type,
          description: sub.description,
          stats: await scanTranscript(sub.file, r, { subagent: true }),
        });
    }
    return { session, main, subagents };
  });

  const summary = summarize(inputs, signals, r);
  const id = flag(args, "id") || auditId();
  const last = latestAudit();
  const prev = last ? readSummary(last.id) : null;
  const cmp =
    last && prev
      ? compare(last.id, prev, summary, readFindings(last.id))
      : null;
  writeSummary(id, summary, renderSummary(id, summary, cmp));
  console.log(
    JSON.stringify({
      id,
      since: summary.range.since,
      until: summary.range.until,
      sessions: summary.totals.sessions,
      transcripts: summary.totals.transcripts,
      tokensRead: summary.totals.tokensRead + summary.totals.subagentTokensRead,
      previous: last?.id ?? null,
      summary: path.join(auditsDir(), `${id}.summary.md`),
      report: path.join(auditsDir(), `${id}.md`),
      findings: path.join(auditsDir(), `${id}.json`),
      previousReport: last ? path.join(auditsDir(), `${last.id}.md`) : null,
      ms: Date.now() - started,
    })
  );
}

async function excerpt(args: string[]) {
  const prefix = flag(args, "session");
  const pattern = flag(args, "match");
  if (!prefix || !pattern)
    throw new Error("excerpt needs --session <id prefix> and --match <regex>");
  const limit = Math.min(Number(flag(args, "limit") ?? 5) || 5, 20);
  const r = range(args);
  const db = openDb(dbPath(args));
  const sessions = loadSessions(db, r.since).filter((s) =>
    s.id.startsWith(prefix)
  );
  db.close();
  if (sessions.length !== 1)
    throw new Error(
      `${sessions.length} sessions match "${prefix}" in the range`
    );
  const match = new RegExp(pattern, "i");
  const files = sessions[0].files.flatMap((f) => [
    f,
    ...subagentFiles(f, r.since).map((s) => s.file),
  ]);
  const out = [];
  for (const file of files) {
    if (out.length >= limit) break;
    out.push(...(await findExcerpts(file, r, match, limit - out.length)));
  }
  for (const x of out)
    console.log(
      `- ${x.at} ${x.tool}${x.isError ? " (error)" : ""}\n  in:  ${x.input}\n  out: ${x.output.replace(/\n/g, "⏎ ")}`
    );
  if (!out.length) console.log("No matching calls.");
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "extract") return extract(args);
  if (command === "excerpt") return excerpt(args);
  if (command === "record") {
    if (!args[0]) throw new Error("record needs the audit id");
    return console.log(JSON.stringify(recordAudit(args[0])));
  }
  if (command === "list") {
    for (const e of readIndex())
      console.log(
        `${e.id}  ${e.sessions} sessions  ${e.findings} findings  ${e.headline}`
      );
    return;
  }
  console.error(
    "usage: audit.ts extract|excerpt|record|list (see the header of this file)"
  );
  process.exit(2);
}

if (process.argv[1] && /audit\.ts$/.test(process.argv[1]))
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
