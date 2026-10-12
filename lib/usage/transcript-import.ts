/**
 * Usage from Claude's own transcripts, for the sessions AgentOS runs that it
 * can't watch live (a terminal session) and for the days before live capture.
 * Messages are deduped by id against what the workers recorded, and each file
 * is read from where the last pass stopped.
 */

import fs from "fs";
import os from "os";
import path from "path";
import readline from "readline";
import { db } from "../db";
import {
  callFromAssistant,
  recordCall,
  sessionContext,
  type CallKind,
} from "./calls";

const claudeDir = () =>
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");

interface TranscriptFile {
  file: string;
  sessionId: string;
  // Set for a subagent's file.
  agentType: string | null;
  sidechain: boolean;
}

// Every transcript of a session AgentOS knows, modified since `since`.
export async function transcriptFiles(
  since: number,
  root = path.join(claudeDir(), "projects")
): Promise<TranscriptFile[]> {
  const known = new Map<string, string>();
  const rows = db
    .prepare(
      `SELECT id, claude_session_id FROM sessions WHERE claude_session_id IS NOT NULL`
    )
    .all() as { id: string; claude_session_id: string }[];
  for (const r of rows) known.set(r.claude_session_id, r.id);
  const out: TranscriptFile[] = [];
  const dirs = await fs.promises.readdir(root).catch(() => [] as string[]);
  for (const d of dirs) {
    const dir = path.join(root, d);
    const entries = await fs.promises
      .readdir(dir, { withFileTypes: true })
      .catch(() => []);
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith(".jsonl")) {
        const claudeId = e.name.slice(0, -".jsonl".length);
        const sid = known.get(claudeId);
        if (!sid || !(await newer(path.join(dir, e.name), since))) continue;
        out.push({
          file: path.join(dir, e.name),
          sessionId: sid,
          agentType: null,
          sidechain: false,
        });
      } else if (e.isDirectory() && known.has(e.name)) {
        const sid = known.get(e.name)!;
        const sub = path.join(dir, e.name, "subagents");
        const files = await fs.promises
          .readdir(sub)
          .catch(() => [] as string[]);
        for (const f of files) {
          if (!f.endsWith(".jsonl")) continue;
          const file = path.join(sub, f);
          if (!(await newer(file, since))) continue;
          out.push({
            file,
            sessionId: sid,
            agentType: await agentTypeOf(file),
            sidechain: true,
          });
        }
      }
    }
  }
  return out;
}

async function newer(file: string, since: number): Promise<boolean> {
  const st = await fs.promises.stat(file).catch(() => null);
  return !!st && st.mtimeMs >= since;
}

async function agentTypeOf(file: string): Promise<string | null> {
  try {
    const meta = JSON.parse(
      await fs.promises.readFile(file.replace(/\.jsonl$/, ".meta.json"), "utf8")
    ) as { agentType?: unknown };
    return typeof meta.agentType === "string" ? meta.agentType : null;
  } catch {
    return null;
  }
}

interface Line {
  type?: string;
  timestamp?: string;
  attributionAgent?: string;
  attributionSkill?: string;
  message?: Parameters<typeof callFromAssistant>[0];
}

// Imports one file from its stored offset. Returns the calls it saw.
export async function importFile(
  f: TranscriptFile,
  since: number
): Promise<number> {
  const st = await fs.promises.stat(f.file);
  const saved = db
    .prepare(`SELECT offset, mtime FROM usage_import_offsets WHERE path = ?`)
    .get(f.file) as { offset: number; mtime: number } | undefined;
  // A file shorter than where we stopped was rewritten: start again.
  const start = saved && saved.offset <= st.size ? saved.offset : 0;
  if (
    saved &&
    saved.offset === st.size &&
    saved.mtime === Math.floor(st.mtimeMs)
  )
    return 0;
  const ctx = sessionContext(f.sessionId);
  let offset = start;
  let n = 0;
  const rl = readline.createInterface({
    input: fs.createReadStream(f.file, { encoding: "utf8", start }),
    crlfDelay: Infinity,
  });
  const pending: (() => void)[] = [];
  for await (const line of rl) {
    // A last line still being written has no newline yet.
    const bytes = Buffer.byteLength(line) + 1;
    if (offset + bytes > st.size) break;
    offset += bytes;
    if (!line.includes('"assistant"')) continue;
    let d: Line;
    try {
      d = JSON.parse(line) as Line;
    } catch {
      continue;
    }
    if (d.type !== "assistant") continue;
    const at = d.timestamp ? Date.parse(d.timestamp) : NaN;
    if (!Number.isFinite(at) || at < since) continue;
    const agent = f.agentType ?? d.attributionAgent ?? null;
    const kind: CallKind = !f.sidechain
      ? "main"
      : agent?.startsWith("review-") || d.attributionSkill === "do-code-review"
        ? "review"
        : "sub";
    const call = callFromAssistant(
      d.message,
      kind,
      f.sidechain ? agent : null,
      at
    );
    if (!call) continue;
    pending.push(() => recordCall(call, ctx, "transcript"));
    n++;
  }
  db.transaction(() => {
    for (const w of pending) w();
    db.prepare(
      `INSERT INTO usage_import_offsets (path, offset, mtime) VALUES (?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET offset = excluded.offset, mtime = excluded.mtime`
    ).run(f.file, offset, Math.floor(st.mtimeMs));
  })();
  return n;
}

// One pass over everything modified since `since`, yielding between files so
// the server keeps answering.
export async function importTranscripts(
  since: number,
  maxFiles = 400,
  root?: string
): Promise<{ files: number; calls: number }> {
  const files = (await transcriptFiles(since, root)).slice(0, maxFiles);
  let calls = 0;
  for (const f of files) {
    calls += await importFile(f, since).catch(() => 0);
    await new Promise((r) => setImmediate(r));
  }
  return { files: files.length, calls };
}
