/**
 * Placing starts on linked machines: which machines could take which task,
 * then the best machine for each start this one's load rules out, best score
 * first, one per machine per look. The rules are pure, in placement.ts.
 */

import { getProject } from "../projects";
import { hostLink, linkedHostIds } from "../hosts/remote-api";
import { peerReading, peerSource, refreshPeers } from "../hosts/peer-load";
import { projectMachines } from "../hosts/project-machines";
import { viewOf } from "../load/machines";
import { usesGitCrypt } from "../worktree-add";
import { list as hostTasks } from "./contract/client";
import {
  asPlanPhase,
  place,
  unplaceable,
  wantsPlacing,
  type Need,
  type PeerOption,
  type Placement,
} from "./placement";
import { scoreParts, type Candidate, type MachineView } from "./schedule";
import { expandHome } from "./session";
import { orchestratorOf } from "./starter";
import { lineSignature, row } from "./queue-rows";
import type { QueueRow, QueueRowWithWorkspace } from "./queue-types";

// A plan placed elsewhere may have to come back here to be built, and a
// git-crypt repository never leaves this machine (the key stays here).
function placementBarred(r: Pick<QueueRow, "project_id">): boolean {
  const project = getProject(r.project_id);
  return !project || usesGitCrypt(expandHome(project.working_directory));
}

// The linked machines a task could be placed on, with what they report.
async function peerOptions(
  rows: QueueRowWithWorkspace[],
  now: number
): Promise<Map<string, PeerOption[]>> {
  const out = new Map<string, PeerOption[]>();
  const hostIds = [...linkedHostIds()];
  if (!hostIds.length || !rows.length) return out;
  await refreshPeers(hostIds, now);
  // Whether each machine can hold an orchestrator's task (an older AgentOS
  // can't, and would fail its start); unreadable counts as no.
  const holds = new Map<string, boolean>();
  const plans = new Map<string, boolean>();
  await Promise.all(
    hostIds.map(async (hostId) => {
      const link = hostLink(hostId);
      const caps = link
        ? await hostTasks(link)
            .then((t) => t.capabilities ?? [])
            .catch(() => [])
        : [];
      holds.set(hostId, caps.includes("held-start"));
      plans.set(hostId, caps.includes("remote-plan"));
    })
  );
  const perProject = new Map<string, Record<string, string | null>>();
  for (const r of rows) {
    if (out.has(r.project_id)) continue;
    const project = getProject(r.project_id);
    let can: Record<string, string | null> = {};
    if (project) {
      can =
        perProject.get(project.id) ??
        (await projectMachines(project).catch(() => ({})));
      perProject.set(project.id, can);
    }
    out.set(
      r.project_id,
      hostIds.map((hostId) => {
        const src = peerSource(hostId, now);
        const reading = peerReading(hostId);
        return {
          hostId,
          name: src.label,
          view: viewOf(src, now),
          capabilities: src.capabilities,
          holds: holds.get(hostId) ?? false,
          plans: plans.get(hostId) ?? false,
          hasProject: can[hostId] === null,
          loadPerCore: reading ? reading.load1 / reading.cores : 99,
        };
      })
    );
  }
  return out;
}

// A start that plans first goes by its plan phase: it needs no simulator, and a plan-only one that no machine can take starts here
// as ever (it never waits on load).
const plansFirst = (r: QueueRow) => !!(r.plan || r.plan_only);

// Planning needs no simulator or Xcode, but a Mac pin holds for the plan too:
// the work is Mac-only (often because the other machine can't reach what it
// touches), and the plan-to-implement hand-off doesn't carry the pin.
const macOnly = (needs: Need[]): Need[] => needs.filter((n) => n === "mac");

// Marks each start the home machine's load rules out as remote and returns
// where it goes. "stale": the line moved while the machines were asked, so
// this look is over, and the one a change during it asks for sees the line
// as it is now.
export async function placeCandidates(
  candidates: Candidate[],
  rows: QueueRowWithWorkspace[],
  needsOf: Map<string, Need[]>,
  home: MachineView,
  now: number
): Promise<Map<string, Placement> | "stale"> {
  const placements = new Map<string, Placement>();
  const asked = (c: Candidate) => {
    const r = row(c.id)!;
    return plansFirst(r) ? asPlanPhase(c) : c;
  };
  const toPlace = candidates.filter((c) => {
    if (c.kind !== "start" || c.remote) return false;
    const r = row(c.id)!;
    if (unplaceable(r)) return false;
    if (plansFirst(r) && placementBarred(r)) return false;
    return wantsPlacing(asked(c), home, now);
  });
  if (!toPlace.length) return placements;
  const before = lineSignature();
  const peers = await peerOptions(
    toPlace.map((c) => rows.find((r) => r.id === c.id)!),
    now
  );
  if (lineSignature() !== before) return "stale";
  const taken = new Set<string>();
  for (const c of [...toPlace].sort(
    (a, b) =>
      scoreParts(b, now).score - scoreParts(a, now).score ||
      a.position - b.position
  )) {
    const r = rows.find((x) => x.id === c.id)!;
    const plan = plansFirst(r);
    const options = (peers.get(r.project_id) ?? []).filter(
      (p) =>
        !taken.has(p.hostId) &&
        (!orchestratorOf(r.started_by) || p.holds !== false) &&
        (!plan || p.plans)
    );
    const spot = place(
      asked(c),
      home,
      options,
      plan ? macOnly(needsOf.get(c.id) ?? []) : (needsOf.get(c.id) ?? []),
      now
    );
    if (!spot) continue;
    taken.add(spot.hostId);
    placements.set(c.id, spot);
    c.remote = true;
  }
  return placements;
}
