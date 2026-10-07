/**
 * Which conversation a terminal agent is in, read from where each CLI saves
 * its sessions, so the session can be resumed after its pane is gone. Only
 * a conversation written to in the last few minutes counts: an older one in
 * the same folder is some other session's.
 */

import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import type { ProviderId } from "./registry";

const RECENT_MS = 5 * 60 * 1000;

const recent = (mtimeMs: number, now: number) => now - mtimeMs < RECENT_MS;

function newestFile(
  dir: string,
  pattern: RegExp,
  now: number
): { file: string; mtimeMs: number } | null {
  let best: { file: string; mtimeMs: number } | null = null;
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!pattern.test(name)) continue;
    try {
      const { mtimeMs } = fs.statSync(path.join(dir, name));
      if (recent(mtimeMs, now) && (!best || mtimeMs > best.mtimeMs))
        best = { file: path.join(dir, name), mtimeMs };
    } catch {
      // Gone since the listing.
    }
  }
  return best;
}

const UUID =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\.jsonl$)/;

// ~/.claude/projects/<cwd with / as ->/<id>.jsonl, or the last session the
// CLI recorded for the folder.
export function claudeResumeId(cwd: string, now = Date.now()): string | null {
  const home =
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  const dir = path.join(home, "projects", cwd.replace(/\//g, "-"));
  const found = newestFile(dir, /^(?!agent-)[0-9a-f-]{36}\.jsonl$/, now);
  if (found) return path.basename(found.file, ".jsonl");
  try {
    const config = JSON.parse(
      fs.readFileSync(path.join(home, ".claude.json"), "utf-8")
    );
    return config.projects?.[cwd]?.lastSessionId ?? null;
  } catch {
    return null;
  }
}

// ~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl, whose first line
// names the folder it ran in.
export function codexResumeId(cwd: string, now = Date.now()): string | null {
  const root = path.join(
    process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
    "sessions"
  );
  // Today's folder and yesterday's, for a session running past midnight.
  const candidates = [0, 1]
    .map((d) => new Date(now - d * 86400000))
    .map((d) =>
      newestFile(
        path.join(
          root,
          String(d.getFullYear()),
          String(d.getMonth() + 1).padStart(2, "0"),
          String(d.getDate()).padStart(2, "0")
        ),
        /^rollout-.*\.jsonl$/,
        now
      )
    )
    .filter((f): f is { file: string; mtimeMs: number } => !!f)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const { file } of candidates) {
    if (rolloutCwd(file) === cwd) return file.match(UUID)?.[0] ?? null;
  }
  return null;
}

function rolloutCwd(file: string): string | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const m = buf
      .subarray(0, n)
      .toString("utf8")
      .match(/"cwd":"((?:[^"\\]|\\.)*)"/);
    return m ? (JSON.parse(`"${m[1]}"`) as string) : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// ~/.pi/agent/sessions/--<cwd with / as ->--/<time>_<id>.jsonl
export function piResumeId(cwd: string, now = Date.now()): string | null {
  const root =
    process.env.PI_CODING_AGENT_SESSION_DIR ||
    path.join(
      process.env.PI_CODING_AGENT_DIR ||
        path.join(os.homedir(), ".pi", "agent"),
      "sessions"
    );
  const dir = path.join(
    root,
    `--${cwd.replace(/^\//, "").replace(/\//g, "-")}--`
  );
  const found = newestFile(dir, /_[0-9a-f-]{36}\.jsonl$/, now);
  return found ? (found.file.match(UUID)?.[0] ?? null) : null;
}

// OpenCode keeps sessions in SQLite, with the folder each ran in.
export function opencodeResumeId(cwd: string, now = Date.now()): string | null {
  const file = path.join(
    process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"),
    "opencode",
    "opencode.db"
  );
  if (!fs.existsSync(file)) return null;
  let db: Database.Database | undefined;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const row = db
      .prepare(
        `SELECT id FROM session WHERE directory = ? AND parent_id IS NULL
           AND time_updated > ? ORDER BY time_updated DESC LIMIT 1`
      )
      .get(cwd, now - RECENT_MS) as { id: string } | undefined;
    return row?.id ?? null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

const FINDERS: Partial<
  Record<ProviderId, (cwd: string, now?: number) => string | null>
> = {
  claude: claudeResumeId,
  codex: codexResumeId,
  pi: piResumeId,
  opencode: opencodeResumeId,
};

export function findResumeId(agent: ProviderId, cwd: string): string | null {
  return FINDERS[agent]?.(cwd) ?? null;
}
