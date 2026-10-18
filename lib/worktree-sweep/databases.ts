/**
 * Task databases left behind: copies and what projects derived from them
 * (`<copy>_test`), found by the `_aos_<12 hex>` token every session's name
 * carries. A database goes only if its token belongs to no live session,
 * nobody is connected, it isn't a project's declared source, and it is more
 * than a day old. Anything without the token is never looked at.
 */

import { db } from "../db";
import { loadProjectConfig } from "../project-config";
import { expandHome } from "../project-config/session";
import {
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
  // Databases a project declares as its source, never reaped.
  froms: Set<string>;
}

const where = (s: PgServer) =>
  `${s.host ?? "local server"}${s.port ? `:${s.port}` : ""}`;

// Sessions whose work isn't over on this machine: a deleted, merged, dropped,
// done, archived or moved one no longer needs a database.
export function liveSessionIds(): Set<string> {
  const rows = db
    .prepare(
      `SELECT id FROM session_rows
       WHERE archived_at IS NULL AND settled_at IS NULL
         AND (task_status IS NULL OR task_status IN ('running', 'moving'))`
    )
    .all() as Array<{ id: string }>;
  return new Set(rows.map((r) => r.id));
}

export const liveHashes = (ids = liveSessionIds()): Set<string> =>
  new Set([...ids].map(sessionHash));

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
  `select d.datname, pg_database_size(d.oid),
     (select count(*) from pg_stat_activity a where a.datname = d.datname),
     ${age ? `extract(epoch from (pg_stat_file('base/' || d.oid || '/PG_VERSION')).modification)::bigint` : "0"}
   from pg_database d where d.datname ~ '_aos_[0-9a-f]{12}'`;

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
          const [name, size, conns, at] = line.split("\t");
          return {
            name,
            bytes: Number(size) || 0,
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
      if (deps.froms.has(d.name)) skip("a project's declared source");
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
    ["--if-exists", c.path],
    pgEnv(c.server ?? {})
  );
  return code === 0;
}
