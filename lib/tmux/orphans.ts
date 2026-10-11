import { db } from "../db";
import { getManagedSessionPattern } from "../providers/registry";
import { WORKER_TMUX_PREFIX } from "../chat/worker/protocol";
import { isValidTmuxName } from "../hosts/tmux-name";
import { endTmuxSession } from "./end";
import { tmux } from "./exec";

// tmux sessions AgentOS made whose session row is gone: deleted before every
// end-of-life path ended the agent. Swept once at start. Only sessions that
// carry AgentOS's own marks are ever touched: its names (<agent>-<uuid>,
// aos-chat-<uuid>) or the AGENTOS_SESSION_ID it sets on the session at
// launch. Dispatch's sessions and anyone's own terminals have neither.

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const WORKER_NAME = new RegExp(`^${WORKER_TMUX_PREFIX}(${UUID})$`, "i");
const AGENT_NAME = new RegExp(`(${UUID})$`, "i");

export interface TmuxListing {
  name: string;
  // AGENTOS_SESSION_ID on the session itself; null when absent or when the
  // whole tmux server carries one (every session would then).
  taggedId: string | null;
}

export interface SessionRow {
  id: string;
  tmux_name: string | null;
  host_id: string | null;
}

const isLocal = (hostId: string | null) => !hostId || hostId === "local";

// The AgentOS session id a tmux session belongs to, or null if it isn't one
// of AgentOS's.
export function agentOsIdOf(
  l: TmuxListing,
  managed = getManagedSessionPattern()
): string | null {
  const worker = WORKER_NAME.exec(l.name);
  if (worker) return worker[1].toLowerCase();
  if (managed.test(l.name)) return AGENT_NAME.exec(l.name)![1].toLowerCase();
  return l.taggedId && new RegExp(`^${UUID}$`, "i").test(l.taggedId)
    ? l.taggedId.toLowerCase()
    : null;
}

export function findOrphans(
  listing: TmuxListing[],
  rows: SessionRow[]
): { name: string; id: string }[] {
  const ids = new Set(rows.map((r) => r.id.toLowerCase()));
  const names = new Set(
    rows.filter((r) => isLocal(r.host_id)).map((r) => r.tmux_name)
  );
  const orphans: { name: string; id: string }[] = [];
  for (const l of listing) {
    const id = agentOsIdOf(l);
    if (id && !ids.has(id) && !names.has(l.name))
      orphans.push({ name: l.name, id });
  }
  return orphans;
}

async function taggedId(
  name: string,
  serverWide: boolean
): Promise<string | null> {
  if (serverWide) return null;
  const out = await tmux(
    ["show-environment", "-t", `=${name}`, "AGENTOS_SESSION_ID"],
    5000
  ).catch(() => "");
  return /^AGENTOS_SESSION_ID=(.+)$/m.exec(out)?.[1].trim() ?? null;
}

async function listLocal(createdBefore: number): Promise<TmuxListing[]> {
  const out = await tmux(
    ["list-sessions", "-F", "#{session_created} #{session_name}"],
    5000
  ).catch(() => "");
  // Sessions made after the cutoff belong to work this process started: their
  // rows may not be committed yet, so they are never candidates.
  const names = out
    .split("\n")
    .map((l) => /^(\d+) (.+)$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m && Number(m[1]) <= createdBefore)
    .map((m) => m[2])
    .filter(isValidTmuxName);
  // A server started from inside an agent's shell has the variable in its
  // own environment, which every session on it then shows.
  const global = await tmux(
    ["show-environment", "-g", "AGENTOS_SESSION_ID"],
    5000
  ).catch(() => "");
  const serverWide = /^AGENTOS_SESSION_ID=/m.test(global);
  const managed = getManagedSessionPattern();
  const listing: TmuxListing[] = [];
  for (const name of names) {
    const byName = WORKER_NAME.test(name) || managed.test(name);
    listing.push({
      name,
      taggedId: byName ? null : await taggedId(name, serverWide),
    });
  }
  return listing;
}

const hasRow = (id: string, tmuxName: string) =>
  !!db
    .prepare(`SELECT 1 FROM sessions WHERE id = ? OR tmux_name = ?`)
    .get(id, tmuxName);

export async function sweepOrphanTmux(
  opts: {
    dryRun?: boolean;
    rows?: SessionRow[];
    // Epoch seconds; only tmux sessions created at or before it are swept.
    // Defaults to when this process started.
    createdBefore?: number;
  } = {}
): Promise<{ found: string[]; killed: string[] }> {
  const none = { found: [], killed: [] };
  const rows =
    opts.rows ??
    (db
      .prepare(`SELECT id, tmux_name, host_id FROM sessions`)
      .all() as SessionRow[]);
  // An empty table is a fresh or wrong database, not proof that nothing is
  // alive: never sweep against it.
  if (!rows.length) return none;
  const cutoff =
    opts.createdBefore ?? Math.floor(Date.now() / 1000 - process.uptime());
  const orphans = findOrphans(await listLocal(cutoff), rows);
  const killed: string[] = [];
  for (const o of orphans) {
    if (opts.dryRun) continue;
    // The snapshot is old by now: a row inserted since keeps its session.
    if (!opts.rows && hasRow(o.id, o.name)) continue;
    await endTmuxSession(null, o.name);
    killed.push(o.name);
    console.log(`[tmux-sweep] ended ${o.name}: session ${o.id} has no row`);
  }
  if (killed.length)
    console.log(`[tmux-sweep] ended ${killed.length} orphaned tmux sessions`);
  return { found: orphans.map((o) => o.name), killed };
}
