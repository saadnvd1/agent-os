/**
 * What a linked machine says about itself. The identity is kept in
 * host_info so its name, OS and addresses show while it is offline; the
 * catalog (agents and models) is only held in memory for a minute.
 */

import { getDb } from "../db";
import { hostApi, hostLink, linkedHostIds } from "../hosts/remote-api";
import { isRemoteHost } from "../hosts";
import type { HostCatalogResponse, MachineReport } from "./types";

const CATALOG_TTL_MS = 60_000;
const INFO_TTL_MS = 5 * 60_000;

interface Cached {
  at: number;
  report: MachineReport;
}
const cache = new Map<string, Cached>();
const running = new Map<string, Promise<MachineReport>>();
const tried = new Map<string, number>();

export interface HostInfo {
  hostId: string;
  name: string | null;
  hostname: string | null;
  os: string | null;
  arch: string | null;
  connectMachineId: string | null;
  addresses: string[];
  fetchedAt: number;
}

interface InfoRow {
  host_id: string;
  name: string | null;
  hostname: string | null;
  os: string | null;
  arch: string | null;
  connect_machine_id: string | null;
  addresses: string;
  fetched_at: number;
}

const parseAddresses = (raw: string): string[] => {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((a) => typeof a === "string") : [];
  } catch {
    return [];
  }
};

export function allHostInfo(): HostInfo[] {
  return (getDb().prepare(`SELECT * FROM host_info`).all() as InfoRow[]).map(
    (r) => ({
      hostId: r.host_id,
      name: r.name,
      hostname: r.hostname,
      os: r.os,
      arch: r.arch,
      connectMachineId: r.connect_machine_id,
      addresses: parseAddresses(r.addresses),
      fetchedAt: r.fetched_at,
    })
  );
}

export const hostInfo = (hostId: string): HostInfo | null =>
  allHostInfo().find((i) => i.hostId === hostId) ?? null;

function save(hostId: string, report: MachineReport, now: number): void {
  const i = report.identity;
  getDb()
    .prepare(
      `INSERT INTO host_info (host_id, name, hostname, os, arch, connect_machine_id, addresses, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(host_id) DO UPDATE SET name = excluded.name,
         hostname = excluded.hostname, os = excluded.os, arch = excluded.arch,
         connect_machine_id = excluded.connect_machine_id,
         addresses = excluded.addresses, fetched_at = excluded.fetched_at`
    )
    .run(
      hostId,
      i.name,
      i.hostname,
      i.os,
      i.arch,
      i.connectMachineId,
      JSON.stringify(i.addresses),
      now
    );
}

const text = (v: unknown, max = 120) =>
  typeof v === "string" ? v.slice(0, max) : "";

/** A peer's report, trimmed to the shape we use; anything else is refused. */
export function parseReport(body: unknown): MachineReport | null {
  const b = body as Partial<MachineReport> | null;
  if (!b?.identity || !b.catalog || !Array.isArray(b.catalog.agents))
    return null;
  const i = b.identity;
  return {
    identity: {
      name: text(i.name, 60),
      hostname: text(i.hostname),
      os: text(i.os, 30),
      arch: text(i.arch, 30),
      connectMachineId: text(i.connectMachineId) || null,
      addresses: (Array.isArray(i.addresses) ? i.addresses : [])
        .filter((a): a is string => typeof a === "string")
        .slice(0, 16)
        .map((a) => a.slice(0, 64)),
    },
    catalog: {
      agents: b.catalog.agents.slice(0, 40),
      ollama: Array.isArray(b.catalog.ollama)
        ? b.catalog.ollama.slice(0, 200)
        : [],
    },
  };
}

export async function fetchHostMachine(
  hostId: string,
  now = Date.now()
): Promise<MachineReport> {
  const hit = cache.get(hostId);
  if (hit && now - hit.at < CATALOG_TTL_MS) return hit.report;
  const link = hostLink(hostId);
  if (!link) throw new Error("This machine isn't linked");
  const wait = running.get(hostId);
  if (wait) return wait;
  const p = hostApi<unknown>(link, "/api/machine", { timeout: 12_000 })
    .then((body) => {
      const report = parseReport(body);
      if (!report)
        throw new Error("Its AgentOS answered in a format we can't read");
      cache.set(hostId, { at: now, report });
      save(hostId, report, now);
      return report;
    })
    .finally(() => running.delete(hostId));
  running.set(hostId, p);
  return p;
}

/** The agents of a linked machine, or why they can't be listed. */
export async function hostCatalog(
  hostId: string
): Promise<HostCatalogResponse> {
  if (!isRemoteHost(hostId))
    return { catalog: null, error: "Not a linked machine" };
  try {
    return { catalog: (await fetchHostMachine(hostId)).catalog, error: null };
  } catch (e) {
    const old = /404|not found|forbidden|not allowed/i.test(String(e));
    return {
      catalog: null,
      error: old
        ? "Update AgentOS on that machine to see its agents and models"
        : e instanceof Error
          ? e.message
          : String(e),
    };
  }
}

/** Read every linked machine whose identity is old; failures are ignored. */
export function refreshHostInfo(now = Date.now()): void {
  const have = new Map(allHostInfo().map((i) => [i.hostId, i.fetchedAt]));
  for (const hostId of linkedHostIds()) {
    if (now - (have.get(hostId) ?? 0) < INFO_TTL_MS) continue;
    if (now - (tried.get(hostId) ?? 0) < INFO_TTL_MS) continue;
    tried.set(hostId, now);
    fetchHostMachine(hostId, now).catch(() => undefined);
  }
}
