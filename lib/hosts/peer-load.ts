/**
 * How loaded each linked machine is, for placing tasks. The placing server
 * polls a peer's GET /api/load every PEER_POLL_MS, only while a task is
 * waiting that could go there. A reading older than PEER_STALE_MS counts as
 * red, so nothing is placed on a machine that can't be seen.
 */

import { getHost } from "./index";
import { hostApi, hostLink, linkedHostIds } from "./remote-api";
import { feedGate } from "../load/start-gate";
import type { MachineSource } from "../load/machines";
import type { LoadLevel } from "../load/level";

export const PEER_POLL_MS = 15_000;
export const PEER_STALE_MS = 60_000;

export interface PeerReading {
  at: number;
  level: LoadLevel;
  load1: number;
  cores: number;
  memUsedPct: number;
  booted: number;
  capabilities: string[];
}

const g = globalThis as unknown as {
  __agentosPeerLoad?: Map<string, PeerReading>;
  __agentosPeerPolling?: Map<string, Promise<void>>;
};
const readings = (g.__agentosPeerLoad ??= new Map<string, PeerReading>());
const polling = (g.__agentosPeerPolling ??= new Map<string, Promise<void>>());

const LEVELS = ["green", "amber", "red"];
const num = (v: unknown, max = 1e6) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : null;

// Another machine's answer is data, not trust: anything off is no reading.
export function parseReading(body: unknown, at: number): PeerReading | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const level = b.level;
  const load1 = num(b.load1);
  const cores = num(b.cores, 4096);
  if (typeof level !== "string" || !LEVELS.includes(level)) return null;
  if (load1 === null || !cores) return null;
  const caps = Array.isArray(b.capabilities)
    ? b.capabilities
        .filter((c): c is string => typeof c === "string" && c.length <= 24)
        .slice(0, 12)
    : [];
  return {
    at,
    level: level as LoadLevel,
    load1,
    cores,
    memUsedPct: num(b.memUsedPct, 100) ?? 0,
    booted: num(b.booted, 1000) ?? 0,
    capabilities: caps,
  };
}

export type LoadFetch = (hostId: string) => Promise<unknown>;

const fetchLoad: LoadFetch = (hostId) => {
  const link = hostLink(hostId);
  if (!link) throw new Error("not linked");
  return hostApi<unknown>(link, "/api/load", { timeout: 5000 });
};

// Reads every linked machine whose last reading is older than the poll time.
// A failure keeps the old reading, which then ages into stale.
export async function refreshPeers(
  hostIds: Iterable<string> = linkedHostIds(),
  now = Date.now(),
  fetcher: LoadFetch = fetchLoad
): Promise<void> {
  await Promise.all(
    [...hostIds].map((hostId) => {
      const last = readings.get(hostId);
      if (last && now - last.at < PEER_POLL_MS) return;
      const running = polling.get(hostId);
      if (running) return running;
      const p = fetcher(hostId)
        .then((body) => {
          const r = parseReading(body, now);
          if (!r) return;
          readings.set(hostId, r);
          feedGate(hostId, r.level, now);
        })
        .catch(() => undefined)
        .finally(() => polling.delete(hostId));
      polling.set(hostId, p);
      return p;
    })
  );
}

export function setPeerReading(hostId: string, r: PeerReading | null): void {
  if (r) readings.set(hostId, r);
  else readings.delete(hostId);
}

export function peerReading(hostId: string): PeerReading | null {
  return readings.get(hostId) ?? null;
}

export function peerSource(hostId: string, now: number): MachineSource {
  const r = readings.get(hostId);
  const stale = !r || now - r.at > PEER_STALE_MS;
  return {
    hostId,
    label: getHost(hostId)?.name ?? "that machine",
    level: r?.level ?? null,
    booted: r?.booted ?? 0,
    maxBooted: 2,
    capabilities: r?.capabilities ?? [],
    stale,
  };
}
