import { getDb } from "../db";
import {
  CLAIM_TTL_MS,
  MAX_FILES,
  MAX_HOPS,
  REMOTE_TTL_CAP_MS,
  TOMBSTONE_MS,
  safePath,
  type Claim,
  type ClaimWire,
  type Released,
} from "./types";

interface Row {
  id: string;
  origin: string;
  origin_name: string;
  via_machine: string | null;
  hops: number;
  source: string;
  session_id: string | null;
  session_name: string | null;
  repo: string;
  branch: string | null;
  base: string | null;
  goal: string;
  files: string;
  files_more: number;
  pr_url: string | null;
  started_at: number;
  expires_at: number;
  released: string | null;
  updated_at: number;
}

// Another machine's text: no control characters, one line, short.
export const cleanLine = (s: unknown, max: number) =>
  String(s ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

function parseFiles(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const fromRow = (r: Row): Claim => ({
  id: r.id,
  origin: r.origin,
  originName: r.origin_name,
  viaMachine: r.via_machine,
  hops: r.hops,
  source: "session",
  sessionId: r.session_id,
  sessionName: r.session_name,
  repo: r.repo,
  branch: r.branch,
  base: r.base,
  goal: r.goal,
  files: parseFiles(r.files),
  filesMore: r.files_more,
  prUrl: r.pr_url,
  startedAt: r.started_at,
  expiresAt: r.expires_at,
  released: (r.released as Released | null) ?? null,
  updatedAt: r.updated_at,
});

const SELECT = `SELECT * FROM work_claims`;

export interface LocalClaim {
  sessionId: string;
  sessionName: string;
  repo: string;
  branch: string | null;
  base: string | null;
  goal: string;
  files: string[];
  filesMore: number;
  prUrl: string | null;
}

export const localClaimId = (sessionId: string) => `s-${sessionId}`;

// Renews the claim for a local session; its start stays when it was first seen.
export function upsertLocal(
  origin: { id: string; name: string },
  c: LocalClaim,
  now = Date.now()
): void {
  const id = localClaimId(c.sessionId);
  const files = c.files.filter(safePath).slice(0, MAX_FILES);
  getDb()
    .prepare(
      `INSERT INTO work_claims (id, origin, origin_name, hops, source, session_id,
         session_name, repo, branch, base, goal, files, files_more, pr_url,
         started_at, expires_at, released, updated_at)
       VALUES (@id, @origin, @originName, 0, 'session', @sessionId, @sessionName,
         @repo, @branch, @base, @goal, @files, @filesMore, @prUrl,
         @now, @expires, NULL, @now)
       ON CONFLICT(id) DO UPDATE SET origin_name = @originName,
         session_name = @sessionName, repo = @repo, branch = @branch, base = @base,
         goal = @goal, files = @files, files_more = @filesMore, pr_url = @prUrl,
         expires_at = @expires, released = NULL, updated_at = @now`
    )
    .run({
      id,
      origin: origin.id,
      originName: cleanLine(origin.name, 60),
      sessionId: c.sessionId,
      sessionName: cleanLine(c.sessionName, 120),
      repo: c.repo,
      branch: c.branch,
      base: c.base,
      goal: cleanLine(c.goal, 120) || "(unnamed)",
      files: JSON.stringify(files),
      filesMore: c.filesMore + Math.max(0, c.files.length - files.length),
      prUrl: c.prUrl,
      now,
      expires: now + CLAIM_TTL_MS,
    });
}

// Ends a local claim, kept as a tombstone so the release reaches the peers.
export function release(
  sessionId: string,
  why: Released,
  now = Date.now()
): void {
  getDb()
    .prepare(
      `UPDATE work_claims SET released = ?, expires_at = ?, updated_at = ?
       WHERE id = ? AND (released IS NULL OR released != ?)`
    )
    .run(why, now + TOMBSTONE_MS, now, localClaimId(sessionId), why);
}

// Takes one claim a peer sent. Returns whether it was stored. The row with
// the most life wins, unless a nearer copy (fewer hops) says something newer.
export function upsertRemote(
  self: string,
  sender: string,
  w: ClaimWire,
  now = Date.now(),
  viaHost: string | null = null
): boolean {
  if (w.origin === self || w.hops > MAX_HOPS) return false;
  const files = w.files.map((f) => f.trim()).filter(safePath);
  const expires = now + Math.min(w.ttl_s * 1000, REMOTE_TTL_CAP_MS);
  if (expires <= now) return false;
  const db = getDb();
  const have = db.prepare(`${SELECT} WHERE id = ?`).get(w.id) as
    Row | undefined;
  if (have) {
    if (have.origin === self) return false;
    if (have.released && !w.released && have.expires_at >= expires)
      return false;
    if (expires <= have.expires_at && w.hops >= have.hops) return false;
  }
  db.prepare(
    `INSERT INTO work_claims (id, origin, origin_name, via_machine, via_host, hops, source,
       session_id, session_name, repo, branch, base, goal, files, files_more,
       pr_url, started_at, expires_at, released, updated_at)
     VALUES (@id, @origin, @originName, @via, @viaHost, @hops, 'session', NULL, @sessionName,
       @repo, @branch, @base, @goal, @files, @filesMore, @prUrl, @started,
       @expires, @released, @now)
     ON CONFLICT(id) DO UPDATE SET origin_name = @originName, via_machine = @via, via_host = COALESCE(@viaHost, via_host),
       hops = @hops, session_name = @sessionName, repo = @repo, branch = @branch,
       base = @base, goal = @goal, files = @files, files_more = @filesMore,
       pr_url = @prUrl, started_at = MIN(started_at, @started),
       expires_at = @expires, released = @released, updated_at = @now`
  ).run({
    id: w.id,
    origin: w.origin,
    originName: cleanLine(w.origin_name, 60) || "machine",
    via: sender,
    viaHost,
    hops: w.hops,
    sessionName: cleanLine(w.session_name, 120) || null,
    repo: cleanLine(w.repo, 300).toLowerCase(),
    branch: cleanLine(w.branch, 250) || null,
    base: cleanLine(w.base, 250) || null,
    goal: cleanLine(w.goal, 120) || "(unnamed)",
    files: JSON.stringify(files),
    filesMore: w.files_more + Math.max(0, w.files.length - files.length),
    prUrl: /^https?:\/\//.test(w.pr_url ?? "")
      ? cleanLine(w.pr_url, 300)
      : null,
    started: now - Math.floor(w.age_s * 1000),
    expires,
    released: w.released ?? null,
    now,
  });
  return true;
}

export function purgeExpired(now = Date.now()): number {
  return getDb()
    .prepare(`DELETE FROM work_claims WHERE expires_at <= ?`)
    .run(now).changes;
}

export function liveClaims(
  opts: { repo?: string; now?: number } = {}
): Claim[] {
  const rows = getDb()
    .prepare(
      `${SELECT} WHERE released IS NULL AND expires_at > @now
         ${opts.repo ? "AND repo = @repo" : ""} ORDER BY started_at`
    )
    .all({
      now: opts.now ?? Date.now(),
      ...(opts.repo && { repo: opts.repo }),
    }) as Row[];
  return rows.map(fromRow);
}

// One claim by id while it is alive: not released, not expired. A wait on a
// claim is over when this is null.
export function liveClaim(id: string, now = Date.now()): Claim | null {
  const r = getDb()
    .prepare(`${SELECT} WHERE id = ? AND released IS NULL AND expires_at > ?`)
    .get(id, now) as Row | undefined;
  return r ? fromRow(r) : null;
}

// Local claims whose session is no longer worth claiming for.
export function localLiveSessionIds(): string[] {
  return (
    getDb()
      .prepare(
        `SELECT session_id FROM work_claims
         WHERE session_id IS NOT NULL AND released IS NULL`
      )
      .all() as { session_id: string }[]
  ).map((r) => r.session_id);
}

// What goes to a peer: everything still alive or just released, except what
// the peer itself told us and what is too many hops from its source.
export function wireFor(
  self: string,
  peer: { machineId?: string | null } = {},
  now = Date.now()
): ClaimWire[] {
  const rows = getDb()
    .prepare(`${SELECT} WHERE expires_at > ?`)
    .all(now) as Row[];
  return rows
    .filter(
      (r) =>
        r.hops < MAX_HOPS &&
        (!peer.machineId ||
          (r.origin !== peer.machineId && r.via_machine !== peer.machineId))
    )
    .map((r) => ({
      id: r.id,
      origin: r.origin,
      origin_name: r.origin_name,
      hops: r.origin === self ? 0 : r.hops + 1,
      source: "session",
      session_name: r.session_name,
      repo: r.repo,
      branch: r.branch,
      base: r.base,
      goal: r.goal,
      files: parseFiles(r.files).slice(0, MAX_FILES),
      files_more: r.files_more,
      pr_url: r.pr_url,
      ttl_s: Math.max(0, Math.floor((r.expires_at - now) / 1000)),
      age_s: Math.max(0, Math.floor((now - r.started_at) / 1000)),
      released: (r.released as Released | null) ?? null,
    }));
}

// One claim by id even when released: a tombstone says how it ended.
export function claimById(id: string): Claim | null {
  const r = getDb().prepare(`${SELECT} WHERE id = ?`).get(id) as
    Row | undefined;
  return r ? fromRow(r) : null;
}
