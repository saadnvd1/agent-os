// The claims as the UI and the mobile app read them: plain JSON, with the
// pairs that overlap and when each machine was last heard from.

import { getDb } from "../db";
import { findOverlaps } from "./overlap";
import { machineId, machineName } from "./machine";
import type { Claim, Overlap } from "./types";

export interface MachineView {
  id: string;
  name: string;
  self: boolean;
  // Epoch ms of the last claim or exchange from it; null for this machine.
  lastHeardAt: number | null;
}

export interface OverlapView {
  a: string;
  b: string;
  kinds: Overlap["kinds"];
  shared: string[];
  strength: Overlap["strength"];
}

export interface ClaimsView {
  // The server's clock, so ages don't depend on the browser's.
  now: number;
  machine: { id: string; name: string };
  machines: MachineView[];
  claims: Claim[];
  overlaps: OverlapView[];
}

export const overlapView = (o: Overlap): OverlapView => ({
  a: o.a.id,
  b: o.b.id,
  kinds: o.kinds,
  shared: o.shared,
  strength: o.strength,
});

function peerSeen(): Map<string, number> {
  const rows = getDb()
    .prepare(
      `SELECT machine_id, MAX(seen_at) AS seen FROM claim_peers GROUP BY machine_id`
    )
    .all() as { machine_id: string; seen: number }[];
  return new Map(rows.map((r) => [r.machine_id, r.seen]));
}

export function machinesOf(claims: Claim[]): MachineView[] {
  const self = machineId();
  const seen = peerSeen();
  const byId = new Map<string, MachineView>();
  for (const c of claims) {
    if (c.origin === self) continue;
    const have = byId.get(c.origin);
    const heard = Math.max(seen.get(c.origin) ?? 0, c.updatedAt);
    byId.set(c.origin, {
      id: c.origin,
      name: c.originName,
      self: false,
      lastHeardAt: Math.max(have?.lastHeardAt ?? 0, heard),
    });
  }
  return [
    { id: self, name: machineName(), self: true, lastHeardAt: null },
    ...[...byId.values()].sort((a, b) => a.name.localeCompare(b.name)),
  ];
}

export function claimsView(claims: Claim[]): ClaimsView {
  return {
    now: Date.now(),
    machine: { id: machineId(), name: machineName() },
    machines: machinesOf(claims),
    claims,
    overlaps: findOverlaps(claims).map(overlapView),
  };
}
