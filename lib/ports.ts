/**
 * Port slots: every session with a worktree takes the lowest free slot, and
 * each port its project names in agentos.json is `base + slot`. Stored on the
 * row so a resume gets the same ports; freed when the session ends.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { db } from "./db";

const execFileAsync = promisify(execFile);

export const MAX_SLOT = 200;

// Something outside AgentOS listening on it. lsof exits 1 when nothing is.
export async function isPortInUse(port: number): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
      { timeout: 5000 }
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export const portsFor = (
  bases: Record<string, number>,
  slot: number
): Record<string, number> =>
  Object.fromEntries(
    Object.entries(bases).map(([name, base]) => [name, base + slot])
  );

const parsePorts = (json: string | null | undefined) => {
  if (!json) return null;
  try {
    return JSON.parse(json) as Record<string, number>;
  } catch {
    return null;
  }
};

// The session's ports, or null when it holds no slot.
export function sessionPorts(sessionId: string): Record<string, number> | null {
  const row = db
    .prepare(
      `SELECT ports FROM sessions WHERE id = ? AND port_slot IS NOT NULL`
    )
    .get(sessionId) as { ports: string | null } | undefined;
  return parsePorts(row?.ports);
}

// Ends the allocator didn't see (an archive, a merge noticed later) give
// their slot back before the next one is handed out.
function reclaimEnded(): void {
  db.prepare(
    `UPDATE sessions SET port_slot = NULL, ports = NULL, dev_server_port = NULL
     WHERE port_slot IS NOT NULL
       AND (archived_at IS NOT NULL OR task_status IN ('done', 'merged'))`
  ).run();
}

// Every port another session holds: its slot's ports, and the single port
// sessions from before slots were given.
function portsTaken(exceptId: string): Set<number> {
  const rows = db
    .prepare(
      `SELECT ports, dev_server_port FROM sessions
       WHERE id != ? AND (ports IS NOT NULL OR dev_server_port IS NOT NULL)`
    )
    .all(exceptId) as {
    ports: string | null;
    dev_server_port: number | null;
  }[];
  const taken = new Set<number>();
  for (const r of rows) {
    for (const p of Object.values(parsePorts(r.ports) ?? {})) taken.add(p);
    if (r.dev_server_port) taken.add(r.dev_server_port);
  }
  return taken;
}

const slotsTaken = () =>
  new Set(
    (
      db
        .prepare(`SELECT port_slot FROM sessions WHERE port_slot IS NOT NULL`)
        .all() as { port_slot: number }[]
    ).map((r) => r.port_slot)
  );

/**
 * The session's slot and ports, taking the lowest free slot when it has
 * none. A slot is free when no session holds it, none of its ports is held
 * by another session (another project's bases can meet these), and nothing
 * on the machine is listening on them. The claim rechecks in a transaction,
 * and the unique index refuses a slot a parallel start took first.
 */
export async function allocatePorts(
  sessionId: string,
  bases: Record<string, number>,
  inUse: (port: number) => Promise<boolean> = isPortInUse
): Promise<{ slot: number; ports: Record<string, number> }> {
  const held = db
    .prepare(`SELECT port_slot, ports FROM sessions WHERE id = ?`)
    .get(sessionId) as
    | { port_slot: number | null; ports: string | null }
    | undefined;
  if (!held) throw new Error(`No session ${sessionId}`);
  const existing = parsePorts(held.ports);
  if (held.port_slot != null && existing)
    return { slot: held.port_slot, ports: existing };

  reclaimEnded();
  const claim = db.transaction(
    (slot: number, ports: Record<string, number>) => {
      if (slotsTaken().has(slot)) return false;
      const taken = portsTaken(sessionId);
      if (Object.values(ports).some((p) => taken.has(p))) return false;
      db.prepare(
        `UPDATE sessions SET port_slot = ?, ports = ?, dev_server_port = ? WHERE id = ?`
      ).run(
        slot,
        JSON.stringify(ports),
        Object.values(ports)[0] ?? null,
        sessionId
      );
      return true;
    }
  );

  for (let slot = 1; slot <= MAX_SLOT; slot++) {
    if (slotsTaken().has(slot)) continue;
    const ports = portsFor(bases, slot);
    const values = Object.values(ports);
    if (values.some((p) => p > 65535)) break;
    const taken = portsTaken(sessionId);
    if (values.some((p) => taken.has(p))) continue;
    const busy = await Promise.all(values.map(inUse));
    if (busy.some(Boolean)) continue;
    try {
      // .immediate: the write lock is taken before the recheck reads.
      if (claim.immediate(slot, ports)) return { slot, ports };
    } catch (error) {
      if (!/UNIQUE constraint/.test(String(error))) throw error;
    }
  }
  throw new Error(
    `No free port slot: ${MAX_SLOT} sessions' worth of ports are taken or in use`
  );
}

export function releasePorts(sessionId: string): void {
  db.prepare(
    `UPDATE sessions SET port_slot = NULL, ports = NULL, dev_server_port = NULL WHERE id = ?`
  ).run(sessionId);
}

// The name the session routes call.
export const releasePort = releasePorts;
