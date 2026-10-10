/**
 * agentos.json's `database`: every session gets a private copy of the
 * project's local development database, so one session's migrations and
 * writes never land in another's. As dispatch does it: `createdb -T
 * template0`, then `pg_dump | psql` in one transaction. NOT `createdb -T
 * <from>`, which refuses while anything is connected to <from>, and the dev
 * server in the main checkout always is.
 *
 * The copy is named from the session (`<from>_aos_<hash>`) and carries a
 * comment naming the session, which is the only proof AgentOS made it: a
 * database without it is never reused or dropped. Only a local server is
 * ever contacted.
 */

import { execFile } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { db } from "../db";
import { RESERVED_ENV, type ProjectConfig } from "./schema";

export type DatabaseDecl = NonNullable<ProjectConfig["database"]>;

export interface SessionDatabase {
  // The copy, or null when the session has none (`error` says why).
  name: string | null;
  from: string;
  env: string;
  port?: number;
  host?: string;
  reused?: boolean;
  // Recorded before the copy is made, so a cleanup finds one cut short.
  pending?: boolean;
  error?: string;
}

export type PgRun = (
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv
) => Promise<{ code: number; out: string }>;

const pgRun: PgRun = (cmd, args, env) =>
  new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        env,
        // The copy can take a while; a listing or a drop never should.
        timeout:
          cmd === "pg_dump" || args.includes("-f") ? 30 * 60_000 : 60_000,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const code = (error as NodeJS.ErrnoException | null)?.code;
        resolve({
          code: !error ? 0 : code === "ENOENT" ? 127 : Number(code) || 1,
          out: `${stdout}${stderr}`.trim() || (error?.message ?? ""),
        });
      }
    );
  });

// A plain database name: never a connection string (`host=…`,
// `postgres://…`) or an option, which pg_dump would take as one.
const DB_NAME = /^[A-Za-z0-9_][A-Za-z0-9_$.-]{0,62}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
// One socket folder: libpq reads a comma as a list of hosts to try in turn,
// so `/nope,db.example.com` would reach the second.
const SOCKET_DIR = /^\/[^,=\s'"\\]*$/;

// Why `declared` can't be used, or null. A socket folder is local too.
export function refusal(declared: DatabaseDecl): string | null {
  if (!DB_NAME.test(declared.from))
    return `"${declared.from}" isn't a local database name`;
  if (
    declared.host !== undefined &&
    !LOCAL_HOSTS.has(declared.host) &&
    !SOCKET_DIR.test(declared.host)
  )
    return `${declared.host} isn't this machine: only a local Postgres is copied`;
  const env = declared.env ?? "DATABASE_NAME";
  if (RESERVED_ENV.test(env)) return `${env} is a reserved variable name`;
  return null;
}

const MARK = (sessionId: string) => `agentos session ${sessionId}`;
const PENDING = (sessionId: string) => `${MARK(sessionId)} (copying)`;

// `<from>_aos_<12 hex of the session id>`, within Postgres's 63 bytes.
export function databaseName(from: string, sessionId: string): string {
  const hash = createHash("sha256").update(sessionId).digest("hex");
  const suffix = `_aos_${hash.slice(0, 12)}`;
  return `${from.slice(0, 63 - suffix.length)}${suffix}`;
}

// The server the project names, and none other: an inherited PGHOST,
// PGSERVICE or PGDATABASE could point every command somewhere else.
export function pgEnv(declared: Pick<DatabaseDecl, "port" | "host">) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of [
    "PGHOST",
    "PGHOSTADDR",
    "PGPORT",
    "PGSERVICE",
    "PGSERVICEFILE",
    "PGDATABASE",
  ])
    delete env[name];
  // A server that accepts and never answers fails fast, not in minutes.
  env.PGCONNECT_TIMEOUT = "10";
  if (declared.port) env.PGPORT = String(declared.port);
  if (declared.host) env.PGHOST = declared.host;
  return env;
}

const oneLine = (s: string, n = 200) => {
  const line = s.replace(/\s+/g, " ").trim();
  return line.length > n ? `${line.slice(0, n)}…` : line;
};

// Every database on the server with its comment, or why there's no answer.
async function listDatabases(
  run: PgRun,
  env: NodeJS.ProcessEnv
): Promise<Map<string, string> | string> {
  const { code, out } = await run(
    "psql",
    [
      "-X",
      "-d",
      "postgres",
      "-tAq",
      "-F",
      "\t",
      "-c",
      "select datname, coalesce(shobj_description(oid, 'pg_database'), '') from pg_database",
    ],
    env
  );
  if (code === 127) return "psql isn't installed";
  if (code !== 0) return `Postgres isn't answering (${oneLine(out)})`;
  const map = new Map<string, string>();
  for (const line of out.split("\n")) {
    if (!line) continue;
    const [name, comment = ""] = line.split("\t");
    map.set(name, comment);
  }
  return map;
}

const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;
const quoteLiteral = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function copy(
  run: PgRun,
  env: NodeJS.ProcessEnv,
  from: string,
  target: string,
  sessionId: string
): Promise<string | null> {
  // Marked as ours before anything else, so a copy interrupted here is
  // recognised and remade rather than left or reused half-filled.
  const created = await run(
    "createdb",
    ["-T", "template0", target, PENDING(sessionId)],
    env
  );
  if (created.code !== 0)
    return `could not create ${target}: ${oneLine(created.out)}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-db-"));
  const dump = path.join(dir, "dump.sql");
  try {
    let step = await run(
      "pg_dump",
      ["--no-owner", "--no-privileges", "-f", dump, from],
      env
    );
    if (step.code === 0) {
      // In the restore's transaction: marked done only if it all landed.
      fs.appendFileSync(
        dump,
        `\nCOMMENT ON DATABASE ${quoteIdent(target)} IS ${quoteLiteral(MARK(sessionId))};\n`
      );
      step = await run(
        "psql",
        ["-X", "-q", "-1", "-v", "ON_ERROR_STOP=1", "-d", target, "-f", dump],
        env
      );
    }
    if (step.code !== 0) {
      await run("dropdb", ["--if-exists", target], env);
      return `could not copy ${from} into ${target} (${oneLine(step.out, 300)}); ${target} was dropped again`;
    }
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The session's own copy of `declared.from`, made, or reused when a previous
 * start of this session made it. Never throws: a session whose copy can't
 * be made still starts, with `error` saying why, which its brief repeats.
 */
async function makeDatabase(
  sessionId: string,
  declared: DatabaseDecl,
  run: PgRun,
  record: (state: SessionDatabase) => void
): Promise<SessionDatabase> {
  const state: SessionDatabase = {
    name: null,
    from: declared.from,
    env: declared.env ?? "DATABASE_NAME",
    ...(declared.port ? { port: declared.port } : {}),
    ...(declared.host ? { host: declared.host } : {}),
  };
  const refused = refusal(declared);
  if (refused) return { ...state, error: refused };
  const env = pgEnv(declared);
  const listed = await listDatabases(run, env);
  if (typeof listed === "string") return { ...state, error: listed };
  if (!listed.has(declared.from))
    return {
      ...state,
      error: `${declared.from} doesn't exist, so there's nothing to copy`,
    };
  const target = databaseName(declared.from, sessionId);
  if (target === declared.from)
    return { ...state, error: `${target} is the database it would copy` };
  if (listed.has(target)) {
    const comment = listed.get(target);
    if (comment === MARK(sessionId))
      return { ...state, name: target, reused: true };
    if (comment !== PENDING(sessionId))
      return {
        ...state,
        error: `${target} already exists and AgentOS didn't make it, so it was left alone`,
      };
    // An interrupted copy of ours: made again from the start.
    record({ ...state, name: target, pending: true });
    const dropped = await run("dropdb", ["--if-exists", target], env);
    if (dropped.code !== 0)
      return {
        ...state,
        error: `could not remove the half-made ${target}: ${oneLine(dropped.out)}`,
      };
  }
  record({ ...state, name: target, pending: true });
  const failed = await copy(run, env, declared.from, target, sessionId);
  return failed ? { ...state, error: failed } : { ...state, name: target };
}

const isLocal = (hostId: string | null | undefined) =>
  !hostId || hostId === "local";

export function sessionDatabase(sessionId: string): SessionDatabase | null {
  const row = db
    .prepare(`SELECT database FROM sessions WHERE id = ?`)
    .get(sessionId) as { database: string | null } | undefined;
  if (!row?.database) return null;
  try {
    return JSON.parse(row.database) as SessionDatabase;
  } catch {
    return null;
  }
}

export async function ensureSessionDatabase(
  sessionId: string,
  declared: DatabaseDecl,
  run: PgRun = pgRun
): Promise<SessionDatabase | null> {
  const row = db
    .prepare(`SELECT host_id FROM sessions WHERE id = ?`)
    .get(sessionId) as { host_id: string | null } | undefined;
  if (!row || !isLocal(row.host_id)) return null;
  // Each write only over the last one: a drop that ran meanwhile cleared
  // the record, and the copy made after it must not be written back.
  let last = sessionDatabase(sessionId);
  let written = (
    db.prepare(`SELECT database FROM sessions WHERE id = ?`).get(sessionId) as
      | { database: string | null }
      | undefined
  )?.database;
  const save = (state: SessionDatabase) => {
    const json = JSON.stringify(state);
    const changed = db
      .prepare(
        `UPDATE sessions SET database = ? WHERE id = ? AND database IS ?`
      )
      .run(json, sessionId, written ?? null).changes;
    if (changed) {
      written = json;
      last = state;
    }
    return changed;
  };
  let state: SessionDatabase;
  try {
    state = await makeDatabase(sessionId, declared, run, save);
  } catch (error) {
    const error_ = oneLine((error as Error).message);
    // A copy already begun stays recorded (pending), so the end drops it.
    state = last?.pending
      ? { ...last, error: error_ }
      : {
          name: null,
          from: declared.from,
          env: declared.env ?? "DATABASE_NAME",
          error: error_,
        };
  }
  // The session was deleted, or ended and its drop ran, while the copy was
  // made: nothing else would drop it.
  if (!save(state) && state.name) {
    await dropDatabase(sessionId, state, run).catch(() => {});
    return null;
  }
  return state;
}

// What setup, the agent and its terminals get: the copy's name, and the
// server under both names (the app reads DATABASE_*, a typed psql PG*).
export function databaseEnv(
  state: SessionDatabase | null
): Record<string, string> {
  if (!state?.name || state.pending) return {};
  const env: Record<string, string> = { [state.env]: state.name };
  if (state.port) env.DATABASE_PORT = env.PGPORT = String(state.port);
  if (state.host) env.DATABASE_HOST = env.PGHOST = state.host;
  return env;
}

export function databaseBrief(
  declared: DatabaseDecl | undefined,
  state: SessionDatabase | null
): string | null {
  if (!declared) return null;
  if (state?.name && !state.pending)
    return `- Your own database: \`${state.name}\`, a private copy of \`${state.from}\` made for this session, exported as \`${state.env}\`${state.port ? " with PGPORT/DATABASE_PORT" : ""}${state.host ? " and PGHOST/DATABASE_HOST" : ""}. Writes and migrations are safe there and reach no other session; it is dropped when this session ends.`;
  const why = state?.error
    ? ` (${state.error})`
    : state?.pending
      ? " (its copy was cut short)"
      : "";
  return `- This project gives each session a private copy of \`${declared.from}\`, but this session has none${why}, so \`${declared.env ?? "DATABASE_NAME"}\` isn't set and the app uses the shared database. Don't run migrations or write data there; say so if the task needs it.`;
}

/**
 * Drops the session's copy, only if AgentOS made it for this session (its
 * comment says so) and never `from`. Never throws. The row is read before
 * anything is awaited, so a caller deleting the row next still drops it.
 */
export function dropSessionDatabase(
  sessionId: string,
  run: PgRun = pgRun
): Promise<void> {
  const state = sessionDatabase(sessionId);
  if (!state?.name || state.name === state.from) return Promise.resolve();
  return dropDatabase(sessionId, state, run).catch((error) => {
    console.error(`[database] drop for ${sessionId}:`, error);
  });
}

async function dropDatabase(
  sessionId: string,
  state: SessionDatabase,
  run: PgRun
): Promise<void> {
  const name = state.name!;
  const forget = () =>
    db
      .prepare(`UPDATE sessions SET database = NULL WHERE id = ?`)
      .run(sessionId);
  if (refusal({ from: state.from, host: state.host, env: state.env })) return;
  const env = pgEnv(state);
  const listed = await listDatabases(run, env);
  if (typeof listed === "string") {
    console.warn(`[database] ${name} left: ${listed}`);
    return;
  }
  if (!listed.has(name)) return void forget();
  const comment = listed.get(name);
  if (comment !== MARK(sessionId) && comment !== PENDING(sessionId)) {
    console.warn(`[database] ${name} left: AgentOS didn't make it`);
    return;
  }
  // The session is over: a dev server left running in its worktree and
  // still connected is a straggler, ended by --force (Postgres 13+; a plain
  // drop for an older server).
  let dropped = await run("dropdb", ["--if-exists", "--force", name], env);
  if (dropped.code !== 0)
    dropped = await run("dropdb", ["--if-exists", name], env);
  if (dropped.code === 0) forget();
  else console.warn(`[database] ${name} left: ${oneLine(dropped.out)}`);
}
