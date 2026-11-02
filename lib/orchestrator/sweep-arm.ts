/**
 * The orchestrator's way to turn the full disk clean-up on or off, for this
 * machine or a linked one. Turning it on is Saad's call, so the tool says it's
 * for when he has said to, wants the latest dry run of that machine from the
 * last hour (what it would remove is what he agreed to), and logs who and
 * the dry run's totals. A linked machine is armed over ssh to its own
 * loopback, where its AgentOS trusts the caller: its arm endpoint refuses a
 * device token on purpose.
 */

import { getHost, hostExec, hostIdNamed, isRemoteHost } from "../hosts";
import { remotePort } from "../hosts/link";
import {
  cleanRemoteText,
  hostApi,
  requireHostLink,
  type HostLink,
} from "../hosts/remote-api";
import { fromSqliteTime } from "../session-meta";
import { setReaperArmed } from "../worktree-sweep/settings";
import { sweepNow } from "../worktree-sweep/start";
import { sweepState, type SweepState } from "../worktree-sweep/state";
import type { SweepRun } from "../worktree-sweep/types";
import { addNote } from "./notes";
import { PAUSED_REFUSAL } from "./pause";
import { getWorkspace } from "../workspaces";
import { owner } from "../owner";

export const DRY_RUN_FRESH_MS = 60 * 60 * 1000;

const TOOL_DRY = "sweep_dry_run";
const GB = (b: number) => (b / 1024 ** 3).toFixed(2) + " GB";

type Verdict = { ok: true; run: SweepRun } | { ok: false; why: string };

// The newest dry run decides: an older fresh one doesn't stand in for it.
export function dryRunVerdict(
  runs: SweepRun[],
  where: string,
  now = Date.now()
): Verdict {
  const next = `Run ${TOOL_DRY} for ${where} first (it takes a few minutes), then call sweep_arm again.`;
  const run = runs.find((r) => r.dryRun);
  if (!run) return { ok: false, why: `${where} has no dry run. ${next}` };
  if (!run.finishedAt)
    return {
      ok: false,
      why: `The dry run on ${where} is still going. Wait for it, then call sweep_arm again.`,
    };
  if (run.error)
    return {
      ok: false,
      why: `The latest dry run on ${where} failed (${run.error}). ${next}`,
    };
  const age = now - fromSqliteTime(run.finishedAt).getTime();
  if (age > DRY_RUN_FRESH_MS)
    return {
      ok: false,
      why: `The latest dry run on ${where} is ${Math.round(age / 60000)} minutes old; it must be from the last hour. ${next}`,
    };
  return { ok: true, run };
}

export function totalsLine(run: SweepRun, now = Date.now()): string {
  const d = run.details;
  const mins = run.finishedAt
    ? Math.max(
        0,
        Math.round((now - fromSqliteTime(run.finishedAt).getTime()) / 60000)
      )
    : 0;
  return (
    `dry run #${run.id} (${mins} min ago): would remove ${run.removed} (${GB(run.freedBytes)}), ` +
    `${d?.pendingTotal?.count ?? 0} (${GB(d?.pendingTotal?.bytes ?? 0)}) waiting for the full clean-up, ${run.skipped} kept` +
    (d?.report ? `; list: ${cleanRemoteText(d.report)}` : "")
  );
}

interface Machine {
  hostId: string;
  name: string;
  link: HostLink | null;
}

function machineOf(ref: string): Machine {
  const hostId = hostIdNamed(ref);
  if (!isRemoteHost(hostId))
    return { hostId, name: "this machine", link: null };
  return {
    hostId,
    name: getHost(hostId)?.name ?? ref,
    link: requireHostLink(hostId),
  };
}

// Another machine's numbers, read defensively.
function clean(state: SweepState): SweepState {
  const num = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0);
  return {
    ...state,
    armed: state.armed === true,
    runs: (Array.isArray(state.runs) ? state.runs : []).map((r) => ({
      ...r,
      id: num(r.id),
      dryRun: r.dryRun === true,
      removed: num(r.removed),
      freedBytes: num(r.freedBytes),
      skipped: num(r.skipped),
      error: r.error ? cleanRemoteText(r.error) : null,
    })),
  };
}

const readState = async (m: Machine): Promise<SweepState> =>
  m.link
    ? clean(await hostApi<SweepState>(m.link, "/api/worktree-sweep"))
    : sweepState();

async function setArmed(m: Machine, armed: boolean): Promise<void> {
  if (!m.link) return setReaperArmed(armed);
  if (!armed) {
    await hostApi(m.link, "/api/worktree-sweep", {
      method: "PUT",
      body: { armed: false },
    });
    return;
  }
  const port = remotePort(m.link.url);
  await hostExec(
    m.hostId,
    `curl -fsS -m 10 -X PUT -H 'Content-Type: application/json' -d '{"armed":true}' http://127.0.0.1:${port}/api/worktree-sweep`,
    20000
  ).catch((err) => {
    throw new Error(
      `Couldn't turn it on for ${m.name}: ${cleanRemoteText(err instanceof Error ? err.message : err)}`
    );
  });
  if (!(await readState(m)).armed)
    throw new Error(`${m.name} did not turn the full clean-up on`);
}

export async function sweepArm(
  workspaceId: string,
  machine: string,
  on: boolean,
  reason: string
): Promise<string> {
  const m = machineOf(machine);
  const state = await readState(m);
  const latest = state.runs.find((r) => r.dryRun && r.finishedAt && !r.error);
  if (state.armed === on)
    return `The full clean-up is already ${on ? "on" : "off"} for ${m.name}.`;
  if (on) {
    // Turning it off only makes things safer, so Pause doesn't hold it.
    if (getWorkspace(workspaceId)?.orch_paused_at)
      throw new Error(PAUSED_REFUSAL);
    const verdict = dryRunVerdict(state.runs, m.name);
    if (!verdict.ok) throw new Error(verdict.why);
  }
  await setArmed(m, on);
  const totals = latest ? ` Latest ${totalsLine(latest)}.` : "";
  const line = `Orchestrator turned the full disk clean-up ${on ? "on" : "off"} for ${m.name}: ${reason}.${totals}`;
  addNote(workspaceId, line);
  return line;
}

export async function sweepDryRun(machine: string): Promise<string> {
  const m = machineOf(machine);
  const started = `Dry run started on ${m.name}; it takes a few minutes and removes nothing. When ${owner()} has said to turn the full clean-up on, call sweep_arm: it reads this run.`;
  if (m.link) {
    await hostApi(m.link, "/api/worktree-sweep/run", {
      body: { dryRun: true },
    });
    return started;
  }
  await new Promise<void>((resolve, reject) => {
    sweepNow(true).then(() => resolve(), reject);
    setTimeout(resolve, 250);
  });
  return started;
}
