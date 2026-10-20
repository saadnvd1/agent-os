import { getDb } from "../db";
import { hostLink, linkedHostIds, type HostLink } from "../hosts/remote-api";

export function rememberPeer(
  hostId: string,
  machineId: string,
  now = Date.now()
): void {
  getDb()
    .prepare(
      `INSERT INTO claim_peers (host_id, machine_id, seen_at) VALUES (?, ?, ?)
       ON CONFLICT(host_id) DO UPDATE SET machine_id = excluded.machine_id,
         seen_at = excluded.seen_at`
    )
    .run(hostId, machineId, now);
}

export function peerMachineOf(hostId: string): string | null {
  const r = getDb()
    .prepare(`SELECT machine_id FROM claim_peers WHERE host_id = ?`)
    .get(hostId) as { machine_id: string } | undefined;
  return r?.machine_id ?? null;
}

// One list per machine, best link first (token, then Connect). A Connect pin
// that isn't active is left out: peerCall would only refuse it. Links whose
// machine isn't known yet are each their own machine.
export function exchangeTargets(): HostLink[][] {
  const groups = new Map<string, HostLink[]>();
  for (const hostId of [...linkedHostIds()].sort()) {
    const link = hostLink(hostId);
    if (!link) continue;
    if (link.connect && link.connect.state !== "active") continue;
    const key = peerMachineOf(hostId) ?? `host:${hostId}`;
    groups.set(key, [...(groups.get(key) ?? []), link]);
  }
  return [...groups.values()].map((g) =>
    [...g].sort(
      (a, b) =>
        Number(a.transport === "connect") - Number(b.transport === "connect")
    )
  );
}

// Claims that arrived through a link that has since been suspended or
// unlinked stop counting now, not when their lifetime runs out.
export function dropViaInactive(): number {
  return getDb()
    .prepare(
      `DELETE FROM work_claims WHERE via_host IS NOT NULL
         AND via_host NOT IN (SELECT host_id FROM host_links)
         AND via_host NOT IN (SELECT host_id FROM peer_links WHERE state = 'active')`
    )
    .run().changes;
}
