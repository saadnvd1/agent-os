/**
 * Task databases left behind: copies and what projects derived from them
 * (`<copy>_test`), found by the `_aos_<12 hex>` token every session's name
 * carries. A database goes only if its token belongs to no live session,
 * nobody is connected, it isn't a project's declared source, and it is more
 * than a day old. Anything without the token is never looked at.
 *
 * A session is over only when it is merged, dropped, done or moved away, or
 * its row is gone: archiving and settling can be undone, and an interactive
 * session has no end of its own, so neither keeps a database off the list.
 *
 * Proof of who made it: a copy must carry the `agentos session <id>` comment
 * AgentOS gave it, and the id must hash to the token. Something a project
 * derived from a copy (`<copy>_test`) has no such comment, so it also needs
 * its token to belong to no session this machine has ever known, and the
 * server to be local (a host that isn't localhost or a socket is never
 * reaped on a name alone).
 */

import { db } from "../db";
import { loadProjectConfig } from "../project-config";
import { expandHome } from "../project-config/session";
import {
  LOCAL_HOSTS,
  SOCKET_DIR,
  pgEnv,
  pgRun,
  sessionHash,
  taskHashOf,
  type PgRun,
} from "../project-config/database";
import type { Candidate, SweepSkipped } from "./types";

const DAY_MS = 24 * 3600_000;

export interface PgServer {
  host?: string;
  port?: number;
}

export interface DatabaseDeps {
  now: number;
  run: PgRun;
  servers: PgServer[];
  // Hashes of the sessions that still need their database.
  live: Set<string>;
  // Hashes of every session this machine has a row for, over or not.
  known: Set<string>;
  // Databases a project declares as its source, never reaped.
  froms: Set<string>;
}

const where = (s: PgServer) =>
  `${s.host ?? "local server"}${s.port ? `:${s.port}` : ""}`;

// Sessions whose work isn't over: everything with a row except a task that
// merged, was dropped, finished or moved away.
export function liveSessionIds(): Set<string> {
  const rows = db
    .prepare(
      `SELECT id FROM session_rows
       WHERE task_status IS NULL
          OR task_status NOT IN ('merged', 'dropped', 'done', 'moved')`
    )
    .all() as Array<{ id: string }>;
  return new Set(rows.map((r) => r.id));
}

export const knownSessionIds = (): Set<string> =>
  new Set(
    (
      db.prepare(`SELECT id FROM session_rows`).all() as Array<{ id: string }>
    ).map((r) => r.id)
  );

export const hashesOf = (ids: Iterable<string>): Set<string> =>
  new Set([...ids].map(sessionHash));

export const liveHashes = (ids = liveSessionIds()): Set<string> =>
  hashesOf(ids);

const isLocal = (s: PgServer) =>
  !s.host || LOCAL_HOSTS.has(s.host) || SOCKET_DIR.test(s.host);

// Every project's declared database source and server.
export function declaredDatabases(): {
  servers: PgServer[];
  froms: Set<string>;
} {
  const rows = db
    .prepare(
      `SELECT working_directory FROM projects WHERE working_directory IS NOT NULL`
    )
    .all() as Array<{ working_directory: string }>;
  const servers = new Map<string, PgServer>([[":", {}]]);
  const froms = new Set<string>();
  for (const r of rows) {
    try {
      const d = loadProjectConfig(expandHome(r.working_directory)).config
        .database;
      if (!d) continue;
      froms.add(d.from);
      servers.set(`${d.host ?? ""}:${d.port ?? ""}`, {
        host: d.host,
        port: d.port,
      });
    } catch {
      // A project whose config can't be read declares nothing.
    }
  }
  return { servers: [...servers.values()], froms };
}

const LIST = (age: boolean) =>
  `select d.datname, pg_database_size(d.oid), coalesce(shobj_description(d.oid, 'pg_database'), ''),
     (select count(*) from pg_stat_activity a where a.datname = d.datname),
     ${age ? `extract(epoch from (pg_stat_file('base/' || d.oid || '/PG_VERSION')).modification)::bigint` : "0"}
   from pg_database d where d.datname ~ '_aos_[0-9a-f]{12}'`;

// Why this database can't be shown to be a session's, or null when it can.
function whoMade(
  hash: string,
  note: string,
  known: Set<string>,
  server: PgServer
): string | null {
  const m = /^agentos session (\S+?)(?: \(copying\))?$/.exec(note);
  if (m)
    return sessionHash(m[1]) === hash
      ? null
      : "its comment names another session";
  if (note) return "it has a comment that isn't AgentOS's";
  if (known.has(hash))
    return "no AgentOS comment on it, and its session is known here";
  return isLocal(server) ? null : "no AgentOS comment, and not a local server";
}

async function list(deps: DatabaseDeps, server: PgServer) {
  const env = pgEnv(server);
  for (const age of [true, false]) {
    const { code, out } = await deps.run(
      "psql",
      ["-X", "-d", "postgres", "-tAq", "-F", "\t", "-c", LIST(age)],
      env
    );
    if (code === 0)
      return out
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [name, size, note, conns, at] = line.split("\t");
          return {
            name,
            bytes: Number(size) || 0,
            note: note ?? "",
            conns: Number(conns) || 0,
            madeAt: Number(at) * 1000 || 0,
          };
        });
    if (code === 127) return "psql isn't installed";
    if (!age) return `Postgres isn't answering (${out.slice(0, 120)})`;
  }
  return "Postgres isn't answering";
}

export async function findTaskDatabases(deps: DatabaseDeps): Promise<{
  candidates: Candidate[];
  skipped: SweepSkipped[];
}> {
  const candidates: Candidate[] = [];
  const skipped: SweepSkipped[] = [];
  for (const server of deps.servers) {
    const found = await list(deps, server);
    if (typeof found === "string") {
      skipped.push({
        path: where(server),
        kind: "database",
        reason: found,
      });
      continue;
    }
    for (const d of found) {
      const hash = taskHashOf(d.name);
      const skip = (reason: string) =>
        skipped.push({ path: d.name, kind: "database", reason });
      if (!hash) continue;
      const proof = whoMade(hash, d.note, deps.known, server);
      if (deps.froms.has(d.name)) skip("a project's declared source");
      else if (proof) skip(proof);
      else if (deps.live.has(hash)) skip("its session is still running");
      else if (d.conns > 0) skip(`${d.conns} connection(s) open`);
      else if (d.madeAt && deps.now - d.madeAt < DAY_MS)
        skip("made less than a day ago");
      else
        candidates.push({
          path: d.name,
          kind: "database",
          server,
          bytes: d.bytes,
          why: `no session needs it${d.madeAt ? "" : " (age unknown)"}`,
        });
    }
  }
  return { candidates, skipped };
}

// Re-checked here as well: only a name carrying the token is ever dropped,
// and a plain drop, which Postgres refuses while anyone is connected.
export async function dropTaskDatabase(
  c: Candidate,
  froms: Set<string>,
  run: PgRun = pgRun
): Promise<boolean> {
  if (!taskHashOf(c.path) || froms.has(c.path)) return false;
  const { code } = await run(
    "dropdb",
    ["--if-exists", "--", c.path],
    pgEnv(c.server ?? {})
  );
  return code === 0;
}
