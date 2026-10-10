/**
 * A linked machine's session setup, read from its AgentOS for the setup card
 * here. Its push topic doesn't reach this machine, so the card polls it
 * (`relayed`) while it runs. Another machine's answer: only the expected
 * shape is kept, capped.
 */

import { cleanRemoteText, hostApi, type HostLink } from "../hosts/remote-api";
import type { SetupView, StageState } from "./setup-progress";

const STATES = new Set<StageState>([
  "pending",
  "running",
  "ok",
  "failed",
  "skipped",
]);
const STATUSES = new Set(["running", "ok", "failed"]);
const str = (v: unknown, max: number) =>
  typeof v === "string" ? cleanRemoteText(v).slice(0, max) : null;

export type RelayedSetup = Omit<SetupView, "startedAt"> & {
  startedAt: number | null;
  relayed: true;
};

export function toRelayedSetup(raw: unknown): RelayedSetup | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!STATUSES.has(r.status as string)) return null;
  const stages = (Array.isArray(r.stages) ? r.stages : [])
    .slice(0, 10)
    .flatMap((s) => {
      const st = s as Record<string, unknown>;
      const id = str(st?.id, 20);
      const label = str(st?.label, 60);
      return id && label && STATES.has(st.state as StageState)
        ? [{ id, label, state: st.state as StageState }]
        : [];
    });
  return {
    status: r.status as SetupView["status"],
    stages: stages as SetupView["stages"],
    log: (Array.isArray(r.log) ? r.log : [])
      .slice(-40)
      .flatMap((l) => (typeof l === "string" ? [str(l, 500)!] : [])),
    branch: str(r.branch, 200),
    error: str(r.error, 2000),
    startedAt:
      typeof r.startedAt === "number" && Number.isFinite(r.startedAt)
        ? r.startedAt
        : null,
    relayed: true,
  };
}

// Nothing to show when that machine can't be reached: the chat says so.
export async function relayedSetup(
  link: HostLink,
  sessionId: string
): Promise<RelayedSetup | null> {
  try {
    const { setup } = await hostApi<{ setup?: unknown }>(
      link,
      `/api/sessions/${encodeURIComponent(sessionId)}/setup`,
      { timeout: 5000 }
    );
    return toRelayedSetup(setup);
  } catch {
    return null;
  }
}
