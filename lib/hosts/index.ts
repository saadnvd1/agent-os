import { randomUUID } from "crypto";
import { getDb, type Host } from "../db";
import {
  LOCAL_HOST_ID,
  isValidSshTarget,
  runOnTarget,
  type ExecResult,
} from "./ssh";

export { LOCAL_HOST_ID, isValidSshTarget } from "./ssh";

export const LOCAL_HOST: Host = {
  id: LOCAL_HOST_ID,
  name: "This machine",
  ssh_target: "",
  sort_order: -1,
  created_at: "",
};

export function isRemoteHost(hostId: string | null | undefined): boolean {
  return !!hostId && hostId !== LOCAL_HOST_ID;
}

export function listRemoteHosts(): Host[] {
  return getDb()
    .prepare(
      `SELECT h.*, EXISTS (SELECT 1 FROM host_links l WHERE l.host_id = h.id) AS linked
         FROM hosts h ORDER BY sort_order, created_at`
    )
    .all() as Host[];
}

export function listHosts(): Host[] {
  return [LOCAL_HOST, ...listRemoteHosts()];
}

export function getHost(hostId: string | null | undefined): Host | null {
  if (!isRemoteHost(hostId)) return LOCAL_HOST;
  return (
    (getDb().prepare(`SELECT * FROM hosts WHERE id = ?`).get(hostId) as
      | Host
      | undefined) ?? null
  );
}

/** A machine by its name (any case) or id. */
export function hostIdNamed(ref: string): string {
  const want = ref.trim().toLowerCase();
  if (want === "local" || want === "this machine") return LOCAL_HOST_ID;
  const host = listRemoteHosts().find(
    (h) => h.id === ref || h.name.toLowerCase() === want
  );
  if (!host) throw new Error(`No machine named "${ref}" (see Machines)`);
  return host.id;
}

export function createHost(name: string, sshTarget: string): Host {
  if (!name.trim()) throw new Error("Name is required");
  if (!isValidSshTarget(sshTarget)) {
    throw new Error("ssh target must look like user@host or an ssh alias");
  }
  const db = getDb();
  const id = randomUUID();
  const { max } = db
    .prepare(`SELECT COALESCE(MAX(sort_order), 0) AS max FROM hosts`)
    .get() as { max: number };
  db.prepare(
    `INSERT INTO hosts (id, name, ssh_target, sort_order) VALUES (?, ?, ?, ?)`
  ).run(id, name.trim(), sshTarget, max + 1);
  return getHost(id)!;
}

export function deleteHost(hostId: string): void {
  if (!isRemoteHost(hostId)) throw new Error("Cannot remove this machine");
  const db = getDb();
  const inUse = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM projects WHERE host_id = ?) +
              (SELECT COUNT(*) FROM sessions WHERE host_id = ?) AS n`
    )
    .get(hostId, hostId) as { n: number };
  if (inUse.n > 0) {
    throw new Error("Move or delete its projects and sessions first");
  }
  db.prepare(`DELETE FROM host_links WHERE host_id = ?`).run(hostId);
  db.prepare(`DELETE FROM hosts WHERE id = ?`).run(hostId);
}

export function sshTargetFor(hostId: string | null | undefined): string | null {
  if (!isRemoteHost(hostId)) return null;
  const host = getHost(hostId);
  if (!host) throw new Error(`Unknown host: ${hostId}`);
  return host.ssh_target;
}

export function hostExec(
  hostId: string | null | undefined,
  command: string,
  timeout?: number
): Promise<ExecResult> {
  return runOnTarget(sshTargetFor(hostId), command, timeout);
}
